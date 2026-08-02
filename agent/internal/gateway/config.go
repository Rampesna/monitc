package gateway

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ListenAddress        string
	DatabaseURL          string
	StateDirectory       string
	CACertificate        string
	CAKey                string
	ServerCertificate    string
	ServerKey            string
	ServerNames          []string
	TrustDomain          string
	ClientCertificateTTL time.Duration
	SampleInterval       time.Duration
	BatchInterval        time.Duration
	HeartbeatInterval    time.Duration
	MaxReceiveBytes      int
	MaxSendBytes         int
}

func LoadConfig() (Config, error) {
	stateDirectory := envOr("MONITC_AGENT_GATEWAY_STATE_DIR", "/var/lib/monitc-agent-gateway")
	config := Config{
		ListenAddress:        envOr("MONITC_AGENT_GATEWAY_LISTEN", ":9443"),
		DatabaseURL:          strings.TrimSpace(os.Getenv("DATABASE_URL")),
		StateDirectory:       stateDirectory,
		CACertificate:        envOr("MONITC_AGENT_CA_CERT", filepath.Join(stateDirectory, "pki", "ca.crt")),
		CAKey:                envOr("MONITC_AGENT_CA_KEY", filepath.Join(stateDirectory, "pki", "ca.key")),
		ServerCertificate:    envOr("MONITC_AGENT_SERVER_CERT", filepath.Join(stateDirectory, "pki", "server.crt")),
		ServerKey:            envOr("MONITC_AGENT_SERVER_KEY", filepath.Join(stateDirectory, "pki", "server.key")),
		ServerNames:          commaList(envOr("MONITC_AGENT_SERVER_NAMES", "localhost")),
		TrustDomain:          envOr("MONITC_AGENT_TRUST_DOMAIN", "monitc.talhacan.com"),
		ClientCertificateTTL: durationOr("MONITC_AGENT_CERT_TTL", 7*24*time.Hour),
		SampleInterval:       durationOr("MONITC_AGENT_SAMPLE_INTERVAL", time.Second),
		BatchInterval:        durationOr("MONITC_AGENT_BATCH_INTERVAL", 2*time.Second),
		HeartbeatInterval:    durationOr("MONITC_AGENT_HEARTBEAT_INTERVAL", 15*time.Second),
		MaxReceiveBytes:      integerOr("MONITC_AGENT_MAX_RECEIVE_BYTES", 16<<20),
		MaxSendBytes:         integerOr("MONITC_AGENT_MAX_SEND_BYTES", 4<<20),
	}

	if config.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if len(config.ServerNames) == 0 {
		return Config{}, errors.New("MONITC_AGENT_SERVER_NAMES must contain at least one DNS name or IP address")
	}
	if config.ClientCertificateTTL < time.Hour || config.ClientCertificateTTL > 30*24*time.Hour {
		return Config{}, errors.New("MONITC_AGENT_CERT_TTL must be between 1h and 720h")
	}
	if config.SampleInterval < 250*time.Millisecond || config.SampleInterval > time.Minute {
		return Config{}, errors.New("MONITC_AGENT_SAMPLE_INTERVAL must be between 250ms and 1m")
	}
	if config.BatchInterval < 250*time.Millisecond || config.BatchInterval > time.Minute {
		return Config{}, errors.New("MONITC_AGENT_BATCH_INTERVAL must be between 250ms and 1m")
	}
	if config.HeartbeatInterval < 5*time.Second || config.HeartbeatInterval > 5*time.Minute {
		return Config{}, errors.New("MONITC_AGENT_HEARTBEAT_INTERVAL must be between 5s and 5m")
	}
	return config, nil
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func durationOr(name string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func integerOr(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func commaList(value string) []string {
	var result []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			result = append(result, item)
		}
	}
	return result
}

func (c Config) ValidateFiles() error {
	for _, path := range []string{c.CACertificate, c.CAKey, c.ServerCertificate, c.ServerKey} {
		if path == "" {
			return fmt.Errorf("PKI path cannot be empty")
		}
	}
	return nil
}
