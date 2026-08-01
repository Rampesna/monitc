package gateway

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
)

const fileModePrivate = 0o600

type Authority struct {
	caCertificate     *x509.Certificate
	caSigner          crypto.Signer
	caPEM             []byte
	serverCertificate tls.Certificate
	trustDomain       string
	clientTTL         time.Duration
}

func EnsureAuthority(config Config) (*Authority, error) {
	if err := config.ValidateFiles(); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(config.CACertificate), 0o700); err != nil {
		return nil, fmt.Errorf("create PKI directory: %w", err)
	}

	caCertificate, caSigner, caPEM, err := loadOrCreateCA(config.CACertificate, config.CAKey, config.TrustDomain)
	if err != nil {
		return nil, err
	}
	serverCertificate, err := loadOrCreateServerCertificate(config, caCertificate, caSigner)
	if err != nil {
		return nil, err
	}

	return &Authority{
		caCertificate:     caCertificate,
		caSigner:          caSigner,
		caPEM:             caPEM,
		serverCertificate: serverCertificate,
		trustDomain:       config.TrustDomain,
		clientTTL:         config.ClientCertificateTTL,
	}, nil
}

func (a *Authority) ServerTLSConfig() *tls.Config {
	clientPool := x509.NewCertPool()
	clientPool.AddCert(a.caCertificate)
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{a.serverCertificate},
		ClientCAs:    clientPool,
		ClientAuth:   tls.VerifyClientCertIfGiven,
		NextProtos:   []string{"h2"},
	}
}

func (a *Authority) CAPEM() []byte {
	return append([]byte(nil), a.caPEM...)
}

func (a *Authority) SignAgentCSR(csrPEM []byte, agentID string) ([]byte, string, time.Time, error) {
	block, _ := pem.Decode(csrPEM)
	if block == nil || block.Type != "CERTIFICATE REQUEST" {
		return nil, "", time.Time{}, errors.New("invalid PEM certificate request")
	}
	csr, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil {
		return nil, "", time.Time{}, fmt.Errorf("parse certificate request: %w", err)
	}
	if err := csr.CheckSignature(); err != nil {
		return nil, "", time.Time{}, fmt.Errorf("verify certificate request: %w", err)
	}
	if err := validateAgentPublicKey(csr.PublicKey); err != nil {
		return nil, "", time.Time{}, err
	}

	now := time.Now().UTC()
	expiresAt := now.Add(a.clientTTL)
	serial, err := randomSerial()
	if err != nil {
		return nil, "", time.Time{}, err
	}
	identityURI := &url.URL{Scheme: "spiffe", Host: a.trustDomain, Path: "/agent/" + agentID}
	template := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "monitc-agent"},
		NotBefore:             now.Add(-2 * time.Minute),
		NotAfter:              expiresAt,
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		URIs:                  []*url.URL{identityURI},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, a.caCertificate, csr.PublicKey, a.caSigner)
	if err != nil {
		return nil, "", time.Time{}, fmt.Errorf("sign agent certificate: %w", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), serial.Text(16), expiresAt, nil
}

func AgentIdentityFromPeer(authPeer *peer.Peer, trustDomain string) (string, string, error) {
	if authPeer == nil {
		return "", "", errors.New("client certificate is required")
	}
	tlsInfo, ok := authPeer.AuthInfo.(credentials.TLSInfo)
	if !ok || len(tlsInfo.State.VerifiedChains) == 0 || len(tlsInfo.State.VerifiedChains[0]) == 0 {
		return "", "", errors.New("verified client certificate is required")
	}
	certificate := tlsInfo.State.VerifiedChains[0][0]
	for _, identity := range certificate.URIs {
		if identity.Scheme != "spiffe" || identity.Host != trustDomain {
			continue
		}
		const prefix = "/agent/"
		if strings.HasPrefix(identity.Path, prefix) && len(identity.Path) > len(prefix) {
			return strings.TrimPrefix(identity.Path, prefix), certificate.SerialNumber.Text(16), nil
		}
	}
	return "", "", errors.New("client certificate does not contain a valid Monitc agent identity")
}

func loadOrCreateCA(certificatePath, keyPath, trustDomain string) (*x509.Certificate, crypto.Signer, []byte, error) {
	certificatePEM, certificateErr := os.ReadFile(certificatePath)
	keyPEM, keyErr := os.ReadFile(keyPath)
	if certificateErr == nil && keyErr == nil {
		certificate, signer, err := parseCA(certificatePEM, keyPEM)
		return certificate, signer, certificatePEM, err
	}
	if !errors.Is(certificateErr, os.ErrNotExist) || !errors.Is(keyErr, os.ErrNotExist) {
		return nil, nil, nil, fmt.Errorf("CA certificate and key must either both exist or both be absent")
	}

	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("generate CA key: %w", err)
	}
	serial, err := randomSerial()
	if err != nil {
		return nil, nil, nil, err
	}
	now := time.Now().UTC()
	template := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "Monitc Agent CA", Organization: []string{"Monitc"}},
		NotBefore:             now.Add(-5 * time.Minute),
		NotAfter:              now.AddDate(10, 0, 0),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
		DNSNames:              []string{trustDomain},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("create CA certificate: %w", err)
	}
	certificatePEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyBytes, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("marshal CA key: %w", err)
	}
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyBytes})
	if err := writePrivateFile(certificatePath, certificatePEM); err != nil {
		return nil, nil, nil, err
	}
	if err := writePrivateFile(keyPath, keyPEM); err != nil {
		return nil, nil, nil, err
	}
	certificate, err := x509.ParseCertificate(der)
	return certificate, privateKey, certificatePEM, err
}

func parseCA(certificatePEM, keyPEM []byte) (*x509.Certificate, crypto.Signer, error) {
	certificateBlock, _ := pem.Decode(certificatePEM)
	if certificateBlock == nil || certificateBlock.Type != "CERTIFICATE" {
		return nil, nil, errors.New("invalid CA certificate PEM")
	}
	certificate, err := x509.ParseCertificate(certificateBlock.Bytes)
	if err != nil || !certificate.IsCA {
		return nil, nil, errors.New("invalid CA certificate")
	}
	keyBlock, _ := pem.Decode(keyPEM)
	if keyBlock == nil {
		return nil, nil, errors.New("invalid CA key PEM")
	}
	key, err := x509.ParsePKCS8PrivateKey(keyBlock.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("parse CA key: %w", err)
	}
	signer, ok := key.(crypto.Signer)
	if !ok {
		return nil, nil, errors.New("CA key is not a signing key")
	}
	return certificate, signer, nil
}

func loadOrCreateServerCertificate(config Config, ca *x509.Certificate, signer crypto.Signer) (tls.Certificate, error) {
	if certificate, err := tls.LoadX509KeyPair(config.ServerCertificate, config.ServerKey); err == nil {
		if len(certificate.Certificate) > 0 {
			leaf, parseErr := x509.ParseCertificate(certificate.Certificate[0])
			if parseErr == nil && time.Until(leaf.NotAfter) > 24*time.Hour {
				certificate.Leaf = leaf
				return certificate, nil
			}
		}
	}

	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("generate server key: %w", err)
	}
	serial, err := randomSerial()
	if err != nil {
		return tls.Certificate{}, err
	}
	template := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: config.ServerNames[0]},
		NotBefore:             time.Now().UTC().Add(-5 * time.Minute),
		NotAfter:              time.Now().UTC().AddDate(1, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	for _, name := range config.ServerNames {
		if address := net.ParseIP(name); address != nil {
			template.IPAddresses = append(template.IPAddresses, address)
		} else {
			template.DNSNames = append(template.DNSNames, name)
		}
	}
	der, err := x509.CreateCertificate(rand.Reader, template, ca, &privateKey.PublicKey, signer)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("create server certificate: %w", err)
	}
	certificatePEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyBytes, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return tls.Certificate{}, fmt.Errorf("marshal server key: %w", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyBytes})
	if err := writePrivateFile(config.ServerCertificate, certificatePEM); err != nil {
		return tls.Certificate{}, err
	}
	if err := writePrivateFile(config.ServerKey, keyPEM); err != nil {
		return tls.Certificate{}, err
	}
	certificate, err := tls.X509KeyPair(certificatePEM, keyPEM)
	if err == nil {
		certificate.Leaf = template
	}
	return certificate, err
}

func validateAgentPublicKey(key any) error {
	switch value := key.(type) {
	case *ecdsa.PublicKey:
		if value.Curve != elliptic.P256() && value.Curve != elliptic.P384() {
			return errors.New("agent CSR must use P-256 or P-384")
		}
		return nil
	default:
		return errors.New("agent CSR must use an ECDSA key")
	}
}

func randomSerial() (*big.Int, error) {
	limit := new(big.Int).Lsh(big.NewInt(1), 128)
	serial, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return nil, fmt.Errorf("generate certificate serial: %w", err)
	}
	return serial, nil
}

func writePrivateFile(path string, content []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create parent directory for %s: %w", path, err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".monitc-pki-*")
	if err != nil {
		return fmt.Errorf("create temporary PKI file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(fileModePrivate); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return fmt.Errorf("install PKI file %s: %w", path, err)
	}
	return nil
}
