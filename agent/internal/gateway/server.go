package gateway

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	agentv1 "github.com/Rampesna/monitc/agent/gen/monitc/agent/v1"
	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

const maximumCSRBytes = 32 * 1024

type Service struct {
	agentv1.UnimplementedAgentGatewayServiceServer
	store     *Store
	authority *Authority
	config    Config
	logger    *slog.Logger
	pairLimit *pairingRateLimiter
}

func NewService(store *Store, authority *Authority, config Config, logger *slog.Logger) *Service {
	return &Service{
		store: store, authority: authority, config: config, logger: logger,
		pairLimit: newPairingRateLimiter(),
	}
}

func (s *Service) Pair(ctx context.Context, request *agentv1.PairRequest) (*agentv1.PairResponse, error) {
	if !s.pairLimit.Allow(pairingPeerKey(ctx), time.Now()) {
		return nil, status.Error(codes.ResourceExhausted, "too many pairing attempts; retry later")
	}
	if err := validatePairRequest(request); err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	policy, err := s.store.ValidatePairingToken(ctx, request.GetPairingToken(), s.config.SampleInterval)
	if err != nil {
		if errors.Is(err, ErrPairingTokenInvalid) {
			return nil, status.Error(codes.PermissionDenied, "pairing token is invalid or expired")
		}
		s.logger.Error("pairing token validation failed", "error", err)
		return nil, status.Error(codes.Internal, "pairing could not be completed")
	}

	agentID := uuid.NewString()
	certificatePEM, serial, expiresAt, err := s.authority.SignAgentCSR(request.GetCertificateRequestPem(), agentID)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "certificate request was rejected")
	}
	registration := AgentRegistration{
		AgentID:              agentID,
		InstanceID:           request.GetInstanceId(),
		CertificateSerial:    serial,
		CertificateExpiresAt: expiresAt,
		Version:              safeMetadata(request.GetAgentVersion(), 64),
		OperatingSystem:      safeMetadata(request.GetOperatingSystem(), 32),
		Architecture:         safeMetadata(request.GetArchitecture(), 32),
		KernelVersion:        safeMetadata(request.GetKernelVersion(), 128),
		Capabilities:         request.GetCapabilities(),
	}
	if err := s.store.RegisterAgent(ctx, request.GetPairingToken(), policy, registration); err != nil {
		if errors.Is(err, ErrPairingTokenInvalid) {
			return nil, status.Error(codes.PermissionDenied, "pairing token is invalid or already used")
		}
		s.logger.Error("agent registration failed", "server_id", policy.ServerID, "error", err)
		return nil, status.Error(codes.Internal, "pairing could not be completed")
	}

	s.logger.Info("agent paired", "agent_id", agentID, "server_id", policy.ServerID, "version", registration.Version)
	return &agentv1.PairResponse{
		CertificateBundle: &agentv1.CertificateBundle{
			AgentId:                  agentID,
			ServerId:                 policy.ServerID,
			ClientCertificatePem:     certificatePEM,
			CaCertificatePem:         s.authority.CAPEM(),
			CertificateExpiresAtUnix: expiresAt.Unix(),
		},
		SampleIntervalMillis:     durationMillis(policy.SampleInterval),
		BatchIntervalMillis:      durationMillis(max(s.config.BatchInterval, policy.SampleInterval)),
		HeartbeatIntervalSeconds: durationSeconds(s.config.HeartbeatInterval),
	}, nil
}

func (s *Service) RotateCertificate(ctx context.Context, request *agentv1.RotateCertificateRequest) (*agentv1.RotateCertificateResponse, error) {
	if len(request.GetCertificateRequestPem()) == 0 || len(request.GetCertificateRequestPem()) > maximumCSRBytes {
		return nil, status.Error(codes.InvalidArgument, "a valid certificate request is required")
	}
	if !validFieldLimit(request.GetAgentVersion(), 64) {
		return nil, status.Error(codes.InvalidArgument, "agent_version is invalid")
	}
	if err := validateCapabilities(request.GetCapabilities()); err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	agentID, currentSerial, err := identityFromContext(ctx, s.config.TrustDomain)
	if err != nil {
		return nil, status.Error(codes.Unauthenticated, "a valid agent certificate is required")
	}
	certificatePEM, newSerial, expiresAt, err := s.authority.SignAgentCSR(request.GetCertificateRequestPem(), agentID)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "certificate request was rejected")
	}
	record, err := s.store.RotateAgentCertificate(ctx, agentID, currentSerial, newSerial, expiresAt,
		safeMetadata(request.GetAgentVersion(), 64), request.GetCapabilities())
	if err != nil {
		if errors.Is(err, ErrAgentUnauthorized) {
			return nil, status.Error(codes.PermissionDenied, "agent identity has been revoked")
		}
		s.logger.Error("agent certificate rotation failed", "agent_id", agentID, "error", err)
		return nil, status.Error(codes.Internal, "certificate could not be rotated")
	}
	return &agentv1.RotateCertificateResponse{CertificateBundle: &agentv1.CertificateBundle{
		AgentId:                  agentID,
		ServerId:                 record.ServerID,
		ClientCertificatePem:     certificatePEM,
		CaCertificatePem:         s.authority.CAPEM(),
		CertificateExpiresAtUnix: expiresAt.Unix(),
	}}, nil
}

func (s *Service) Connect(stream grpc.BidiStreamingServer[agentv1.ConnectRequest, agentv1.ConnectResponse]) error {
	ctx := stream.Context()
	agentID, certificateSerial, err := identityFromContext(ctx, s.config.TrustDomain)
	if err != nil {
		return status.Error(codes.Unauthenticated, "a valid agent certificate is required")
	}
	record, err := s.store.AgentByID(ctx, agentID, certificateSerial)
	if err != nil {
		if errors.Is(err, ErrAgentUnauthorized) {
			return status.Error(codes.PermissionDenied, "agent identity has been revoked")
		}
		s.logger.Error("agent identity lookup failed", "agent_id", agentID, "error", err)
		return status.Error(codes.Internal, "agent connection could not be authorized")
	}

	first, err := stream.Recv()
	if err != nil {
		return normalizeStreamError(err)
	}
	hello := first.GetHello()
	if hello == nil || hello.GetAgentId() != record.AgentID || hello.GetInstanceId() != record.InstanceID {
		return status.Error(codes.PermissionDenied, "agent hello does not match certificate identity")
	}
	if err := validateAgentHello(record, hello); err != nil {
		return status.Error(codes.InvalidArgument, "agent hello failed validation")
	}
	connectionID := uuid.NewString()
	if err := s.store.MarkConnected(ctx, record, hello, connectionID); err != nil {
		s.logger.Error("mark agent connected failed", "agent_id", agentID, "error", err)
		return status.Error(codes.Internal, "agent connection could not be initialized")
	}
	defer func() {
		if err := s.store.MarkDisconnected(context.WithoutCancel(ctx), record, connectionID); err != nil {
			s.logger.Warn("mark agent disconnected failed", "agent_id", agentID, "error", err)
		}
	}()

	configuration := &agentv1.AgentConfiguration{
		SampleIntervalMillis:     durationMillis(record.SampleInterval),
		BatchIntervalMillis:      durationMillis(max(s.config.BatchInterval, record.SampleInterval)),
		HeartbeatIntervalSeconds: durationSeconds(s.config.HeartbeatInterval),
		EnabledCapabilities:      record.EnabledCapabilities,
		MaxSpoolBytes:            256 << 20,
	}
	if err := stream.Send(&agentv1.ConnectResponse{Payload: &agentv1.ConnectResponse_Welcome{Welcome: &agentv1.Welcome{
		ConnectionId:        connectionID,
		ServerId:            record.ServerID,
		Configuration:       configuration,
		ServerTimeUnixNanos: time.Now().UTC().UnixNano(),
	}}}); err != nil {
		return normalizeStreamError(err)
	}
	s.logger.Info("agent connected", "agent_id", agentID, "server_id", record.ServerID, "connection_id", connectionID)

	for {
		request, err := stream.Recv()
		if err != nil {
			return normalizeStreamError(err)
		}
		switch payload := request.GetPayload().(type) {
		case *agentv1.ConnectRequest_MetricBatch:
			if validationErr := validateMetricBatch(record, payload.MetricBatch, time.Now().UTC()); validationErr != nil {
				s.logger.Warn("agent metric batch rejected", "agent_id", agentID, "error", validationErr)
				return status.Error(codes.InvalidArgument, "metric batch failed validation")
			}
			throughSequence, saveErr := s.store.SaveMetricBatch(ctx, record, payload.MetricBatch)
			if saveErr != nil {
				if errors.Is(saveErr, ErrAgentUnauthorized) {
					return status.Error(codes.PermissionDenied, "metric batch identity mismatch")
				}
				s.logger.Error("metric batch persistence failed", "agent_id", agentID, "error", saveErr)
				return status.Error(codes.Unavailable, "metric batch could not be persisted")
			}
			if err := stream.Send(&agentv1.ConnectResponse{Payload: &agentv1.ConnectResponse_Acknowledgement{
				Acknowledgement: &agentv1.BatchAcknowledgement{ThroughSequence: throughSequence, BootId: payload.MetricBatch.GetBootId()},
			}}); err != nil {
				return normalizeStreamError(err)
			}
		case *agentv1.ConnectRequest_Heartbeat:
			if validationErr := validateHeartbeat(record, payload.Heartbeat, time.Now().UTC()); validationErr != nil {
				return status.Error(codes.InvalidArgument, "heartbeat failed validation")
			}
			if err := s.store.SaveHeartbeat(ctx, record, payload.Heartbeat); err != nil {
				s.logger.Warn("heartbeat persistence failed", "agent_id", agentID, "error", err)
			}
		case *agentv1.ConnectRequest_Hello:
			if validationErr := validateAgentHello(record, payload.Hello); validationErr != nil {
				return status.Error(codes.InvalidArgument, "agent hello failed validation")
			}
			if err := s.store.MarkConnected(ctx, record, payload.Hello, connectionID); err != nil {
				return status.Error(codes.Unavailable, "agent metadata could not be refreshed")
			}
		case *agentv1.ConnectRequest_CommandResult:
			if !hasCapability(record, agentv1.Capability_CAPABILITY_COMMAND_EXEC) {
				return status.Error(codes.PermissionDenied, "command capability is not enabled")
			}
			if !validFieldLimit(payload.CommandResult.GetCommandId(), 128) {
				return status.Error(codes.InvalidArgument, "command result failed validation")
			}
			s.logger.Info("agent command result received", "agent_id", agentID,
				"command_id", safeMetadata(payload.CommandResult.GetCommandId(), 128), "exit_code", payload.CommandResult.GetExitCode())
		default:
			return status.Error(codes.InvalidArgument, "unsupported agent message")
		}
	}
}

func validatePairRequest(request *agentv1.PairRequest) error {
	if request == nil {
		return errors.New("pair request is required")
	}
	tokenLength := len(request.GetPairingToken())
	if tokenLength < 32 || tokenLength > 512 {
		return errors.New("pairing token is invalid")
	}
	if len(request.GetCertificateRequestPem()) == 0 || len(request.GetCertificateRequestPem()) > maximumCSRBytes {
		return errors.New("a valid certificate request is required")
	}
	if _, err := uuid.Parse(request.GetInstanceId()); err != nil {
		return errors.New("instance_id must be a UUID")
	}
	if strings.TrimSpace(request.GetAgentVersion()) == "" {
		return errors.New("agent_version is required")
	}
	if !validAgentMetadata(request.GetHostname(), request.GetOperatingSystem(), request.GetArchitecture(),
		request.GetKernelVersion(), request.GetAgentVersion()) {
		return errors.New("agent metadata is invalid")
	}
	if err := validateCapabilities(request.GetCapabilities()); err != nil {
		return err
	}
	return nil
}

func identityFromContext(ctx context.Context, trustDomain string) (string, string, error) {
	authPeer, ok := peer.FromContext(ctx)
	if !ok {
		return "", "", errors.New("missing authenticated peer")
	}
	return AgentIdentityFromPeer(authPeer, trustDomain)
}

func normalizeStreamError(err error) error {
	if errors.Is(err, io.EOF) || errors.Is(err, context.Canceled) {
		return nil
	}
	if status.Code(err) != codes.Unknown {
		return err
	}
	return status.Error(codes.Unavailable, "agent stream closed")
}

func safeMetadata(value string, maximum int) string {
	value = strings.TrimSpace(value)
	var result strings.Builder
	result.Grow(min(len(value), maximum))
	for _, character := range value {
		if character < 0x20 || character == 0x7f {
			continue
		}
		width := len(string(character))
		if result.Len()+width > maximum {
			break
		}
		result.WriteRune(character)
	}
	return result.String()
}

func durationMillis(value time.Duration) uint32 {
	milliseconds := value.Milliseconds()
	if milliseconds <= 0 {
		return 1
	}
	if milliseconds > int64(^uint32(0)) {
		return ^uint32(0)
	}
	return uint32(milliseconds)
}

func durationSeconds(value time.Duration) uint32 {
	seconds := value.Seconds()
	if seconds <= 0 {
		return 1
	}
	return uint32(seconds)
}

func (s *Service) String() string {
	return fmt.Sprintf("Monitc agent gateway (%s)", s.config.ListenAddress)
}
