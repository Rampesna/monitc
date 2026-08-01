package agent

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
)

type Identity struct {
	mu                   sync.Mutex
	directory            string
	InstanceID           string    `json:"instanceId"`
	AgentID              string    `json:"agentId,omitempty"`
	ServerID             string    `json:"serverId,omitempty"`
	CertificateExpiresAt time.Time `json:"certificateExpiresAt,omitempty"`
	BootID               string    `json:"bootId,omitempty"`
	LastSequence         uint64    `json:"lastSequence,omitempty"`
	AcknowledgedBootID   string    `json:"acknowledgedBootId,omitempty"`
	AcknowledgedSequence uint64    `json:"acknowledgedSequence,omitempty"`
}

const (
	identityFileName    = "identity.json"
	privateKeyFileName  = "identity.key"
	certificateFileName = "identity.crt"
	caFileName          = "gateway-ca.crt"
)

func LoadOrCreateIdentity(directory string) (*Identity, error) {
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create state directory: %w", err)
	}
	identity := &Identity{directory: directory}
	content, err := os.ReadFile(filepath.Join(directory, identityFileName))
	if err == nil {
		if err := json.Unmarshal(content, identity); err != nil {
			return nil, fmt.Errorf("decode agent identity: %w", err)
		}
		identity.directory = directory
		if _, err := uuid.Parse(identity.InstanceID); err != nil {
			return nil, errors.New("stored agent instance identity is invalid")
		}
		return identity, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read agent identity: %w", err)
	}
	identity.InstanceID = uuid.NewString()
	if err := identity.saveLocked(); err != nil {
		return nil, err
	}
	return identity, nil
}

func (i *Identity) IsPaired() bool {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.AgentID == "" || i.ServerID == "" || i.CertificateExpiresAt.IsZero() {
		return false
	}
	for _, name := range []string{privateKeyFileName, certificateFileName, caFileName} {
		if info, err := os.Stat(filepath.Join(i.directory, name)); err != nil || !info.Mode().IsRegular() {
			return false
		}
	}
	return true
}

func (i *Identity) EnsurePrivateKeyAndCSR() ([]byte, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	keyPath := filepath.Join(i.directory, privateKeyFileName)
	privateKey, err := loadECDSAPrivateKey(keyPath)
	if errors.Is(err, os.ErrNotExist) {
		privateKey, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return nil, fmt.Errorf("generate agent identity key: %w", err)
		}
		keyBytes, err := x509.MarshalPKCS8PrivateKey(privateKey)
		if err != nil {
			return nil, fmt.Errorf("marshal agent identity key: %w", err)
		}
		if err := atomicWrite(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyBytes}), 0o600); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	request := &x509.CertificateRequest{
		Subject:            pkix.Name{CommonName: "monitc-agent", Organization: []string{"Monitc agent"}},
		SignatureAlgorithm: x509.ECDSAWithSHA256,
	}
	der, err := x509.CreateCertificateRequest(rand.Reader, request, privateKey)
	if err != nil {
		return nil, fmt.Errorf("create agent certificate request: %w", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: der}), nil
}

func (i *Identity) InstallCertificate(agentID, serverID string, certificatePEM, caPEM []byte, expiresAt time.Time) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if _, err := uuid.Parse(agentID); err != nil {
		return errors.New("issued agent identity is invalid")
	}
	if _, err := uuid.Parse(serverID); err != nil {
		return errors.New("issued server identity is invalid")
	}
	certificate, err := x509.ParseCertificate(mustPEMBlock(certificatePEM, "CERTIFICATE"))
	if err != nil {
		return fmt.Errorf("parse issued agent certificate: %w", err)
	}
	caCertificate, err := x509.ParseCertificate(mustPEMBlock(caPEM, "CERTIFICATE"))
	if err != nil {
		return fmt.Errorf("parse gateway CA certificate: %w", err)
	}
	if !caCertificate.IsCA {
		return errors.New("gateway CA certificate is not a certificate authority")
	}
	privateKey, err := loadECDSAPrivateKey(filepath.Join(i.directory, privateKeyFileName))
	if err != nil {
		return err
	}
	publicKey, ok := certificate.PublicKey.(*ecdsa.PublicKey)
	if !ok || !publicKey.Equal(&privateKey.PublicKey) {
		return errors.New("issued certificate does not match the local private key")
	}
	roots := x509.NewCertPool()
	roots.AddCert(caCertificate)
	if _, err := certificate.Verify(x509.VerifyOptions{Roots: roots, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}); err != nil {
		return fmt.Errorf("verify issued agent certificate: %w", err)
	}
	identityMatches := false
	for _, identity := range certificate.URIs {
		if identity.Scheme == "spiffe" && identity.Path == "/agent/"+agentID {
			identityMatches = true
			break
		}
	}
	if !identityMatches {
		return errors.New("issued certificate identity does not match the paired agent")
	}
	if expiresAt.IsZero() || certificate.NotAfter.Sub(expiresAt).Abs() > time.Minute {
		return errors.New("issued certificate expiry does not match the pairing response")
	}
	if err := atomicWrite(filepath.Join(i.directory, certificateFileName), certificatePEM, 0o600); err != nil {
		return err
	}
	if err := atomicWrite(filepath.Join(i.directory, caFileName), caPEM, 0o600); err != nil {
		return err
	}
	i.AgentID = agentID
	i.ServerID = serverID
	i.CertificateExpiresAt = certificate.NotAfter.UTC()
	return i.saveLocked()
}

func (i *Identity) TLSCertificate() (tls.Certificate, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	return tls.LoadX509KeyPair(filepath.Join(i.directory, certificateFileName), filepath.Join(i.directory, privateKeyFileName))
}

func (i *Identity) GatewayCAPool(bootstrapCAPath string) (*x509.CertPool, error) {
	i.mu.Lock()
	pairedCAPath := filepath.Join(i.directory, caFileName)
	i.mu.Unlock()
	caPath := bootstrapCAPath
	if _, err := os.Stat(pairedCAPath); err == nil {
		caPath = pairedCAPath
	}
	if caPath == "" {
		return nil, errors.New("gateway CA file is required before pairing")
	}
	content, err := os.ReadFile(caPath)
	if err != nil {
		return nil, fmt.Errorf("read gateway CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(content) {
		return nil, errors.New("gateway CA file contains no certificates")
	}
	return pool, nil
}

func (i *Identity) NeedsRotation(now time.Time) bool {
	i.mu.Lock()
	defer i.mu.Unlock()
	return !i.CertificateExpiresAt.IsZero() && i.CertificateExpiresAt.Sub(now) < 24*time.Hour
}

func (i *Identity) RotationDelay(now time.Time) time.Duration {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.CertificateExpiresAt.IsZero() {
		return 0
	}
	return max(i.CertificateExpiresAt.Sub(now)-24*time.Hour, 0)
}

func (i *Identity) NextSequence(bootID string) uint64 {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.BootID != bootID {
		i.BootID = bootID
		i.LastSequence = 0
	}
	i.LastSequence++
	return i.LastSequence
}

func (i *Identity) PersistSequence() error {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.saveLocked()
}

func (i *Identity) EnsureSequenceAtLeast(bootID string, sequence uint64) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	bootID = sanitizeBootID(bootID)
	if bootID == "" {
		return errors.New("boot ID is invalid")
	}
	changed := false
	if i.BootID != bootID {
		i.BootID = bootID
		i.LastSequence = sequence
		changed = true
	} else if sequence > i.LastSequence {
		i.LastSequence = sequence
		changed = true
	}
	if !changed {
		return nil
	}
	return i.saveLocked()
}

func (i *Identity) Acknowledge(bootID string, throughSequence uint64) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	bootID = sanitizeBootID(bootID)
	if bootID == "" {
		return errors.New("acknowledgement boot ID is invalid")
	}
	if i.AcknowledgedBootID != bootID {
		i.AcknowledgedBootID = bootID
		i.AcknowledgedSequence = throughSequence
	} else if throughSequence > i.AcknowledgedSequence {
		i.AcknowledgedSequence = throughSequence
	}
	return i.saveLocked()
}

func (i *Identity) Snapshot() Identity {
	i.mu.Lock()
	defer i.mu.Unlock()
	return Identity{
		InstanceID:           i.InstanceID,
		AgentID:              i.AgentID,
		ServerID:             i.ServerID,
		CertificateExpiresAt: i.CertificateExpiresAt,
		BootID:               i.BootID,
		LastSequence:         i.LastSequence,
		AcknowledgedBootID:   i.AcknowledgedBootID,
		AcknowledgedSequence: i.AcknowledgedSequence,
	}
}

func (i *Identity) saveLocked() error {
	content, err := json.MarshalIndent(struct {
		InstanceID           string    `json:"instanceId"`
		AgentID              string    `json:"agentId,omitempty"`
		ServerID             string    `json:"serverId,omitempty"`
		CertificateExpiresAt time.Time `json:"certificateExpiresAt,omitempty"`
		BootID               string    `json:"bootId,omitempty"`
		LastSequence         uint64    `json:"lastSequence,omitempty"`
		AcknowledgedBootID   string    `json:"acknowledgedBootId,omitempty"`
		AcknowledgedSequence uint64    `json:"acknowledgedSequence,omitempty"`
	}{
		i.InstanceID, i.AgentID, i.ServerID, i.CertificateExpiresAt,
		i.BootID, i.LastSequence, i.AcknowledgedBootID, i.AcknowledgedSequence,
	}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode agent identity: %w", err)
	}
	return atomicWrite(filepath.Join(i.directory, identityFileName), append(content, '\n'), 0o600)
}

func loadECDSAPrivateKey(path string) (*ecdsa.PrivateKey, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(content)
	if block == nil {
		return nil, errors.New("stored identity key is invalid")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse stored identity key: %w", err)
	}
	ecdsaKey, ok := key.(*ecdsa.PrivateKey)
	if !ok || ecdsaKey.Curve != elliptic.P256() {
		return nil, errors.New("stored identity key is not ECDSA P-256")
	}
	return ecdsaKey, nil
}

func mustPEMBlock(content []byte, expectedType string) []byte {
	block, _ := pem.Decode(content)
	if block == nil || block.Type != expectedType {
		return nil
	}
	return block.Bytes
}

func atomicWrite(path string, content []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".monitc-agent-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(mode); err != nil {
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
		return err
	}
	return nil
}
