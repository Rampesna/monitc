package gateway

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"path/filepath"
	"testing"
	"time"

	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
)

func TestAuthorityIssuesSPIFFEAgentIdentity(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	config := Config{
		CACertificate:        filepath.Join(directory, "ca.crt"),
		CAKey:                filepath.Join(directory, "ca.key"),
		ServerCertificate:    filepath.Join(directory, "server.crt"),
		ServerKey:            filepath.Join(directory, "server.key"),
		ServerNames:          []string{"agent.example.test"},
		TrustDomain:          "example.test",
		ClientCertificateTTL: 24 * time.Hour,
	}
	authority, err := EnsureAuthority(config)
	if err != nil {
		t.Fatal(err)
	}
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	requestDER, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{
		Subject: pkix.Name{CommonName: "test-agent"},
	}, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	agentID := "11111111-2222-4333-8444-555555555555"
	certificatePEM, serial, _, err := authority.SignAgentCSR(
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: requestDER}),
		agentID,
	)
	if err != nil {
		t.Fatal(err)
	}
	certificateBlock, _ := pem.Decode(certificatePEM)
	certificate, err := x509.ParseCertificate(certificateBlock.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	rootPool := x509.NewCertPool()
	if !rootPool.AppendCertsFromPEM(authority.CAPEM()) {
		t.Fatal("generated CA could not be loaded")
	}
	chains, err := certificate.Verify(x509.VerifyOptions{
		Roots:     rootPool,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	})
	if err != nil {
		t.Fatal(err)
	}
	peerIdentity, peerSerial, err := AgentIdentityFromPeer(&peer.Peer{AuthInfo: credentials.TLSInfo{
		State: structTLSState(chains),
	}}, config.TrustDomain)
	if err != nil {
		t.Fatal(err)
	}
	if peerIdentity != agentID || peerSerial != serial {
		t.Fatalf("unexpected agent identity %q / %q", peerIdentity, peerSerial)
	}
}

func structTLSState(chains [][]*x509.Certificate) tls.ConnectionState {
	return tls.ConnectionState{VerifiedChains: chains}
}
