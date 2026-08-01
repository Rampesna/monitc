package agent

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Gateway          GatewayConfig   `yaml:"gateway"`
	StateDirectory   string          `yaml:"stateDirectory"`
	Telemetry        TelemetryConfig `yaml:"telemetry"`
	Security         SecurityConfig  `yaml:"security"`
	PairingTokenFile string          `yaml:"-"`
}

type GatewayConfig struct {
	Address    string `yaml:"address"`
	ServerName string `yaml:"serverName"`
	CAFile     string `yaml:"caFile"`
}

type TelemetryConfig struct {
	SampleInterval    time.Duration `yaml:"sampleInterval"`
	BatchInterval     time.Duration `yaml:"batchInterval"`
	InventoryInterval time.Duration `yaml:"inventoryInterval"`
	DockerEnabled     bool          `yaml:"dockerEnabled"`
	DockerSocket      string        `yaml:"dockerSocket"`
	KubernetesEnabled bool          `yaml:"kubernetesEnabled"`
	KubernetesCommand string        `yaml:"kubernetesCommand"`
	Kubeconfig        string        `yaml:"kubeconfig"`
	EBPFEnabled       bool          `yaml:"ebpfEnabled"`
	MaxSpoolBytes     uint64        `yaml:"maxSpoolBytes"`
}

type SecurityConfig struct {
	AllowCommandExecution bool `yaml:"allowCommandExecution"`
	AllowFileRead         bool `yaml:"allowFileRead"`
	AllowFileWrite        bool `yaml:"allowFileWrite"`
	AllowSelfUpdate       bool `yaml:"allowSelfUpdate"`
}

func LoadConfig(path string) (Config, error) {
	config := Config{
		StateDirectory: "/var/lib/monitc-agent",
		Gateway: GatewayConfig{
			Address:    "monitc-agent.talhacan.com:443",
			ServerName: "monitc-agent.talhacan.com",
		},
		Telemetry: TelemetryConfig{
			SampleInterval:    time.Second,
			BatchInterval:     5 * time.Second,
			InventoryInterval: 15 * time.Second,
			DockerEnabled:     true,
			DockerSocket:      "/var/run/docker.sock",
			KubernetesEnabled: true,
			KubernetesCommand: "kubectl",
			EBPFEnabled:       true,
			MaxSpoolBytes:     256 << 20,
		},
	}
	if path != "" {
		content, err := os.ReadFile(path)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return Config{}, fmt.Errorf("read agent configuration: %w", err)
		}
		if err == nil {
			if err := yaml.Unmarshal(content, &config); err != nil {
				return Config{}, fmt.Errorf("decode agent configuration: %w", err)
			}
		}
	}
	applyEnvironment(&config)
	if config.Gateway.Address == "" || config.Gateway.ServerName == "" {
		return Config{}, errors.New("gateway.address and gateway.serverName are required")
	}
	if config.StateDirectory == "" || !filepath.IsAbs(config.StateDirectory) {
		return Config{}, errors.New("stateDirectory must be an absolute path")
	}
	if config.Telemetry.SampleInterval < 250*time.Millisecond || config.Telemetry.SampleInterval > time.Minute {
		return Config{}, errors.New("telemetry.sampleInterval must be between 250ms and 1m")
	}
	if config.Telemetry.BatchInterval < config.Telemetry.SampleInterval || config.Telemetry.BatchInterval > time.Minute {
		return Config{}, errors.New("telemetry.batchInterval must be at least the sample interval and no more than 1m")
	}
	if config.Telemetry.InventoryInterval < 5*time.Second || config.Telemetry.InventoryInterval > 10*time.Minute {
		return Config{}, errors.New("telemetry.inventoryInterval must be between 5s and 10m")
	}
	if config.Telemetry.MaxSpoolBytes < 16<<20 {
		return Config{}, errors.New("telemetry.maxSpoolBytes must be at least 16 MiB")
	}
	return config, nil
}

func applyEnvironment(config *Config) {
	if value := strings.TrimSpace(os.Getenv("MONITC_AGENT_GATEWAY")); value != "" {
		config.Gateway.Address = value
	}
	if value := strings.TrimSpace(os.Getenv("MONITC_AGENT_SERVER_NAME")); value != "" {
		config.Gateway.ServerName = value
	}
	if value := strings.TrimSpace(os.Getenv("MONITC_AGENT_CA_FILE")); value != "" {
		config.Gateway.CAFile = value
	}
	if value := strings.TrimSpace(os.Getenv("MONITC_AGENT_STATE_DIR")); value != "" {
		config.StateDirectory = value
	}
	config.PairingTokenFile = strings.TrimSpace(os.Getenv("MONITC_AGENT_PAIRING_TOKEN_FILE"))
}

func (c Config) PairingToken() (string, error) {
	if token := strings.TrimSpace(os.Getenv("MONITC_AGENT_PAIRING_TOKEN")); token != "" {
		_ = os.Unsetenv("MONITC_AGENT_PAIRING_TOKEN")
		return token, nil
	}
	if c.PairingTokenFile == "" {
		return "", errors.New("MONITC_AGENT_PAIRING_TOKEN or MONITC_AGENT_PAIRING_TOKEN_FILE is required for first-time pairing")
	}
	content, err := os.ReadFile(c.PairingTokenFile)
	if err != nil {
		return "", fmt.Errorf("read pairing token credential: %w", err)
	}
	if len(content) > 2048 {
		return "", errors.New("pairing token credential is too large")
	}
	token := strings.TrimSpace(string(content))
	if token == "" {
		return "", errors.New("pairing token credential is empty")
	}
	return token, nil
}

func (c Config) ClearPairingCredential() error {
	if c.PairingTokenFile == "" {
		return nil
	}
	info, err := os.Lstat(c.PairingTokenFile)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("refusing to remove non-regular pairing credential")
	}
	return os.Remove(c.PairingTokenFile)
}
