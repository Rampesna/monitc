package agent

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"runtime"
	"sync"
	"time"

	agentv1 "github.com/Rampesna/monitc/agent/gen/monitc/agent/v1"
	"github.com/Rampesna/monitc/agent/internal/telemetry"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/status"
)

var errCertificateRotationRequired = errors.New("agent certificate rotation is required")

type Runtime struct {
	config     Config
	identity   *Identity
	spool      *Spool
	host       telemetry.HostCollector
	docker     *telemetry.DockerCollector
	kubernetes *telemetry.KubernetesCollector
	settings   *runtimeSettings
	inventory  *inventoryCache
	logger     *slog.Logger
	version    string
}

type runtimeSettings struct {
	mu                  sync.RWMutex
	sampleInterval      time.Duration
	batchInterval       time.Duration
	heartbeatInterval   time.Duration
	enabledCapabilities map[agentv1.Capability]bool
}

type inventoryCache struct {
	mu                 sync.Mutex
	pods               []*agentv1.KubernetesPodMetric
	containers         []*agentv1.DockerContainerMetric
	sampledAt          time.Time
	generation         uint64
	consumedGeneration uint64
}

func NewRuntime(config Config, version string, logger *slog.Logger) (*Runtime, error) {
	identity, err := LoadOrCreateIdentity(config.StateDirectory)
	if err != nil {
		return nil, err
	}
	spool, err := NewSpool(config.StateDirectory, config.Telemetry.MaxSpoolBytes)
	if err != nil {
		return nil, err
	}
	host, err := telemetry.NewHostCollector(config.Telemetry.EBPFEnabled)
	if err != nil {
		return nil, fmt.Errorf("initialize host telemetry: %w", err)
	}
	highestSpooledSequence, err := spool.HighestSequence(host.Metadata().BootID)
	if err != nil {
		host.Close()
		return nil, fmt.Errorf("inspect metric spool: %w", err)
	}
	if err := identity.EnsureSequenceAtLeast(host.Metadata().BootID, highestSpooledSequence); err != nil {
		host.Close()
		return nil, fmt.Errorf("reconcile metric sequence: %w", err)
	}
	settings := &runtimeSettings{
		sampleInterval:      config.Telemetry.SampleInterval,
		batchInterval:       config.Telemetry.BatchInterval,
		heartbeatInterval:   15 * time.Second,
		enabledCapabilities: map[agentv1.Capability]bool{agentv1.Capability_CAPABILITY_HOST_METRICS: true},
	}
	runtime := &Runtime{
		config: config, identity: identity, spool: spool, host: host,
		settings: settings, inventory: &inventoryCache{}, logger: logger, version: version,
	}
	if config.Telemetry.DockerEnabled {
		runtime.docker = telemetry.NewDockerCollector(config.Telemetry.DockerSocket)
	}
	if config.Telemetry.KubernetesEnabled {
		runtime.kubernetes = telemetry.NewKubernetesCollector(config.Telemetry.KubernetesCommand, config.Telemetry.Kubeconfig)
	}
	return runtime, nil
}

func (r *Runtime) Close() error {
	return r.host.Close()
}

func (r *Runtime) Run(ctx context.Context) error {
	if runtime.GOOS != "linux" {
		return telemetry.ErrUnsupported
	}
	for attempt := 1; !r.identity.IsPaired() && ctx.Err() == nil; attempt++ {
		if err := r.pair(ctx); err != nil {
			delay := reconnectDelay(attempt)
			r.logger.Warn("agent pairing delayed", "retry_in", delay.String(), "code", safeGRPCCode(err))
			select {
			case <-ctx.Done():
				return nil
			case <-time.After(delay):
			}
		}
	}
	if ctx.Err() != nil {
		return nil
	}
	if r.identity.NeedsRotation(time.Now()) {
		if err := r.rotateCertificate(ctx); err != nil {
			return err
		}
	}

	collectorContext, stopCollector := context.WithCancel(ctx)
	defer stopCollector()
	go r.runCollector(collectorContext)
	go r.runInventoryCollector(collectorContext)

	attempt := 0
	for ctx.Err() == nil {
		err := r.connect(ctx)
		if ctx.Err() != nil {
			return nil
		}
		if errors.Is(err, errCertificateRotationRequired) {
			if rotateErr := r.rotateCertificate(ctx); rotateErr == nil {
				attempt = 0
				continue
			} else {
				err = rotateErr
			}
		}
		attempt++
		delay := reconnectDelay(attempt)
		r.logger.Warn("agent stream disconnected", "retry_in", delay.String(), "code", safeGRPCCode(err))
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(delay):
		}
	}
	return nil
}

func (r *Runtime) PairOnly(ctx context.Context) error {
	if r.identity.IsPaired() {
		return nil
	}
	return r.pair(ctx)
}

func (r *Runtime) pair(ctx context.Context) error {
	token, err := r.config.PairingToken()
	if err != nil {
		return err
	}
	csr, err := r.identity.EnsurePrivateKeyAndCSR()
	if err != nil {
		return err
	}
	connection, err := r.newConnection(false)
	if err != nil {
		return err
	}
	defer connection.Close()
	requestContext, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	metadata := r.host.Metadata()
	response, err := agentv1.NewAgentGatewayServiceClient(connection).Pair(requestContext, &agentv1.PairRequest{
		PairingToken:          token,
		CertificateRequestPem: csr,
		InstanceId:            r.identity.InstanceID,
		Hostname:              metadata.Hostname,
		OperatingSystem:       metadata.OperatingSystem,
		Architecture:          metadata.Architecture,
		KernelVersion:         metadata.KernelVersion,
		AgentVersion:          r.version,
		Capabilities:          r.detectCapabilities(requestContext),
	})
	token = ""
	if err != nil {
		return fmt.Errorf("pair agent: %w", err)
	}
	bundle := response.GetCertificateBundle()
	if bundle == nil || bundle.GetAgentId() == "" || bundle.GetServerId() == "" {
		return errors.New("pairing response did not contain an identity")
	}
	if err := r.identity.InstallCertificate(bundle.GetAgentId(), bundle.GetServerId(), bundle.GetClientCertificatePem(),
		bundle.GetCaCertificatePem(), time.Unix(bundle.GetCertificateExpiresAtUnix(), 0)); err != nil {
		return err
	}
	r.settings.update(&agentv1.AgentConfiguration{
		SampleIntervalMillis:     response.GetSampleIntervalMillis(),
		BatchIntervalMillis:      response.GetBatchIntervalMillis(),
		HeartbeatIntervalSeconds: response.GetHeartbeatIntervalSeconds(),
		EnabledCapabilities:      r.detectCapabilities(requestContext),
	})
	if err := r.config.ClearPairingCredential(); err != nil {
		r.logger.Warn("one-time pairing credential could not be removed", "error", err)
	}
	r.logger.Info("agent pairing completed", "agent_id", bundle.GetAgentId(), "server_id", bundle.GetServerId())
	return nil
}

func (r *Runtime) rotateCertificate(ctx context.Context) error {
	csr, err := r.identity.EnsurePrivateKeyAndCSR()
	if err != nil {
		return err
	}
	connection, err := r.newConnection(true)
	if err != nil {
		return err
	}
	defer connection.Close()
	requestContext, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	response, err := agentv1.NewAgentGatewayServiceClient(connection).RotateCertificate(requestContext, &agentv1.RotateCertificateRequest{
		CertificateRequestPem: csr, AgentVersion: r.version, Capabilities: r.detectCapabilities(requestContext),
	})
	if err != nil {
		return fmt.Errorf("rotate agent certificate: %w", err)
	}
	bundle := response.GetCertificateBundle()
	if bundle == nil {
		return errors.New("certificate rotation response was empty")
	}
	if err := r.identity.InstallCertificate(bundle.GetAgentId(), bundle.GetServerId(), bundle.GetClientCertificatePem(),
		bundle.GetCaCertificatePem(), time.Unix(bundle.GetCertificateExpiresAtUnix(), 0)); err != nil {
		return err
	}
	r.logger.Info("agent certificate rotated", "expires_at", time.Unix(bundle.GetCertificateExpiresAtUnix(), 0).UTC())
	return nil
}

func (r *Runtime) connect(ctx context.Context) error {
	connection, err := r.newConnection(true)
	if err != nil {
		return err
	}
	defer connection.Close()
	stream, err := agentv1.NewAgentGatewayServiceClient(connection).Connect(ctx)
	if err != nil {
		return err
	}
	identity := r.identity.Snapshot()
	metadata := r.host.Metadata()
	lastAcknowledgedSequence := uint64(0)
	if identity.AcknowledgedBootID == metadata.BootID {
		lastAcknowledgedSequence = identity.AcknowledgedSequence
	}
	if err := stream.Send(&agentv1.ConnectRequest{Payload: &agentv1.ConnectRequest_Hello{Hello: &agentv1.AgentHello{
		AgentId: identity.AgentID, InstanceId: identity.InstanceID, Hostname: metadata.Hostname,
		OperatingSystem: metadata.OperatingSystem, Architecture: metadata.Architecture,
		KernelVersion: metadata.KernelVersion, AgentVersion: r.version,
		Capabilities: r.detectCapabilities(ctx), EbpfActive: r.host.EBPFActive(),
		BootId: metadata.BootID, LastAckedSequence: lastAcknowledgedSequence,
	}}}); err != nil {
		return err
	}
	first, err := stream.Recv()
	if err != nil {
		return err
	}
	welcome := first.GetWelcome()
	if welcome == nil || welcome.GetServerId() != identity.ServerID {
		return errors.New("gateway did not return a valid welcome message")
	}
	r.settings.update(welcome.GetConfiguration())
	r.logger.Info("agent stream connected", "connection_id", welcome.GetConnectionId(), "server_id", welcome.GetServerId())
	if identity.AcknowledgedBootID != "" {
		if err := r.spool.Acknowledge(identity.AcknowledgedBootID, identity.AcknowledgedSequence); err != nil {
			return fmt.Errorf("prune acknowledged metric spool: %w", err)
		}
	}

	responses := make(chan *agentv1.ConnectResponse, 8)
	receiveErrors := make(chan error, 1)
	go func() {
		for {
			response, receiveErr := stream.Recv()
			if receiveErr != nil {
				receiveErrors <- receiveErr
				return
			}
			select {
			case responses <- response:
			case <-ctx.Done():
				return
			}
		}
	}()

	heartbeatTicker := time.NewTicker(r.settings.heartbeat())
	defer heartbeatTicker.Stop()
	rotationTimer := time.NewTimer(max(r.identity.RotationDelay(time.Now()), time.Second))
	defer rotationTimer.Stop()
	pollTicker := time.NewTicker(500 * time.Millisecond)
	defer pollTicker.Stop()
	var awaiting *SpoolItem

	for {
		if awaiting == nil {
			if oldest, available := r.spool.Oldest(); available {
				batch, readErr := r.spool.Read(oldest)
				if readErr != nil {
					return readErr
				}
				if sendErr := stream.Send(&agentv1.ConnectRequest{Payload: &agentv1.ConnectRequest_MetricBatch{MetricBatch: batch}}); sendErr != nil {
					return sendErr
				}
				awaiting = &oldest
			}
		}

		select {
		case <-ctx.Done():
			return nil
		case err := <-receiveErrors:
			if errors.Is(err, io.EOF) {
				return nil
			}
			if awaiting != nil && isPermanentMetricBatchRejection(err) {
				quarantined, quarantineErr := r.spool.Quarantine(*awaiting)
				if quarantineErr != nil {
					return fmt.Errorf("quarantine permanently rejected metric batch: %w", quarantineErr)
				}
				r.logger.Error("metric batch permanently rejected and quarantined",
					"boot_id", awaiting.BootID, "first_sequence", awaiting.FirstSequence,
					"last_sequence", awaiting.LastSequence, "path", quarantined)
			}
			return err
		case response := <-responses:
			switch payload := response.GetPayload().(type) {
			case *agentv1.ConnectResponse_Acknowledgement:
				acknowledgedCurrent := awaiting != nil && awaiting.BootID == payload.Acknowledgement.GetBootId() &&
					awaiting.LastSequence <= payload.Acknowledgement.GetThroughSequence()
				if acknowledgedCurrent {
					if err := r.spool.AcknowledgeItem(*awaiting); err != nil {
						return err
					}
				} else if err := r.spool.Acknowledge(payload.Acknowledgement.GetBootId(), payload.Acknowledgement.GetThroughSequence()); err != nil {
					return err
				}
				if err := r.identity.Acknowledge(payload.Acknowledgement.GetBootId(), payload.Acknowledgement.GetThroughSequence()); err != nil {
					return err
				}
				if acknowledgedCurrent {
					awaiting = nil
				}
			case *agentv1.ConnectResponse_Configuration:
				r.settings.update(payload.Configuration)
				heartbeatTicker.Reset(r.settings.heartbeat())
			case *agentv1.ConnectResponse_Command:
				result := disabledCommandResult(payload.Command)
				if err := stream.Send(&agentv1.ConnectRequest{Payload: &agentv1.ConnectRequest_CommandResult{CommandResult: result}}); err != nil {
					return err
				}
			case *agentv1.ConnectResponse_Update:
				r.logger.Info("signed agent update offered", "version", payload.Update.GetVersion(), "required", payload.Update.GetRequired())
			}
		case <-heartbeatTicker.C:
			bytes, batches, statsErr := r.spool.Stats()
			if statsErr != nil {
				return statsErr
			}
			if err := stream.Send(&agentv1.ConnectRequest{Payload: &agentv1.ConnectRequest_Heartbeat{Heartbeat: &agentv1.Heartbeat{
				AgentId: identity.AgentID, SentAtUnixNanos: time.Now().UTC().UnixNano(), SpoolBytes: bytes, SpoolBatches: batches,
			}}}); err != nil {
				return err
			}
		case <-rotationTimer.C:
			return errCertificateRotationRequired
		case <-pollTicker.C:
		}
	}
}

func isPermanentMetricBatchRejection(err error) bool {
	streamStatus, ok := status.FromError(err)
	return ok && streamStatus.Code() == codes.InvalidArgument && streamStatus.Message() == "metric batch failed validation"
}

func (r *Runtime) newConnection(withClientIdentity bool) (*grpc.ClientConn, error) {
	rootPool, err := r.identity.GatewayCAPool(r.config.Gateway.CAFile)
	if err != nil {
		return nil, err
	}
	tlsConfig := &tls.Config{
		MinVersion: tls.VersionTLS13, RootCAs: rootPool, ServerName: r.config.Gateway.ServerName,
	}
	if withClientIdentity {
		certificate, err := r.identity.TLSCertificate()
		if err != nil {
			return nil, err
		}
		tlsConfig.Certificates = []tls.Certificate{certificate}
	}
	return grpc.NewClient(r.config.Gateway.Address,
		grpc.WithTransportCredentials(credentials.NewTLS(tlsConfig)),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{Time: 20 * time.Second, Timeout: 5 * time.Second, PermitWithoutStream: false}),
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(16<<20), grpc.MaxCallSendMsgSize(16<<20)),
	)
}

func (r *Runtime) detectCapabilities(ctx context.Context) []agentv1.Capability {
	capabilities := []agentv1.Capability{agentv1.Capability_CAPABILITY_HOST_METRICS}
	probeContext, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if r.docker != nil && r.docker.Available(probeContext) {
		capabilities = append(capabilities, agentv1.Capability_CAPABILITY_DOCKER_READ)
	}
	if r.kubernetes != nil && r.kubernetes.Available() {
		capabilities = append(capabilities, agentv1.Capability_CAPABILITY_KUBERNETES_READ)
	}
	if r.host.EBPFActive() {
		capabilities = append(capabilities, agentv1.Capability_CAPABILITY_EBPF)
	}
	return capabilities
}

func (s *runtimeSettings) update(configuration *agentv1.AgentConfiguration) {
	if configuration == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if value := time.Duration(configuration.GetSampleIntervalMillis()) * time.Millisecond; value >= 250*time.Millisecond && value <= time.Minute {
		s.sampleInterval = value
	}
	if value := time.Duration(configuration.GetBatchIntervalMillis()) * time.Millisecond; value >= s.sampleInterval && value <= time.Minute {
		s.batchInterval = value
	}
	if value := time.Duration(configuration.GetHeartbeatIntervalSeconds()) * time.Second; value >= 5*time.Second && value <= 5*time.Minute {
		s.heartbeatInterval = value
	}
	s.enabledCapabilities = make(map[agentv1.Capability]bool, len(configuration.GetEnabledCapabilities()))
	for _, capability := range configuration.GetEnabledCapabilities() {
		s.enabledCapabilities[capability] = true
	}
}

func (s *runtimeSettings) intervals() (time.Duration, time.Duration) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.sampleInterval, s.batchInterval
}

func (s *runtimeSettings) heartbeat() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.heartbeatInterval
}

func (s *runtimeSettings) enabled(capability agentv1.Capability) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.enabledCapabilities[capability]
}

func (i *inventoryCache) update(pods []*agentv1.KubernetesPodMetric, containers []*agentv1.DockerContainerMetric, sampledAt time.Time) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.pods = pods
	i.containers = containers
	i.sampledAt = sampledAt
	i.generation++
}

func (i *inventoryCache) take() ([]*agentv1.KubernetesPodMetric, []*agentv1.DockerContainerMetric, time.Time) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.generation == i.consumedGeneration {
		return nil, nil, time.Time{}
	}
	i.consumedGeneration = i.generation
	return i.pods, i.containers, i.sampledAt
}

func reconnectDelay(attempt int) time.Duration {
	exponent := min(max(attempt-1, 0), 6)
	maximum := time.Second * time.Duration(1<<exponent)
	maximum = min(maximum, time.Minute)
	if maximum <= time.Second {
		return time.Second
	}
	return time.Duration(rand.Int64N(int64(maximum-time.Second))) + time.Second
}

func safeGRPCCode(err error) string {
	if err == nil {
		return "stream_closed"
	}
	code := status.Code(err)
	if code == codes.Unknown {
		return "connection_error"
	}
	return code.String()
}

func disabledCommandResult(command *agentv1.CommandRequest) *agentv1.CommandResult {
	now := time.Now().UTC().UnixNano()
	return &agentv1.CommandResult{
		CommandId: command.GetCommandId(), ExitCode: -1, ErrorCode: "CAPABILITY_DISABLED",
		StartedAtUnixNanos: now, CompletedAtUnixNanos: now,
	}
}
