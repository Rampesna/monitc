package gateway

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	agentv1 "github.com/Rampesna/monitc/agent/gen/monitc/agent/v1"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrPairingTokenInvalid = errors.New("pairing token is invalid or expired")
	ErrAgentUnauthorized   = errors.New("agent identity is not authorized")
)

type Store struct {
	pool *pgxpool.Pool
}

type PairingPolicy struct {
	WorkspaceID         string
	ServerID            string
	SampleInterval      time.Duration
	EnabledCapabilities []agentv1.Capability
}

type AgentRegistration struct {
	AgentID              string
	InstanceID           string
	CertificateSerial    string
	CertificateExpiresAt time.Time
	Version              string
	OperatingSystem      string
	Architecture         string
	KernelVersion        string
	Capabilities         []agentv1.Capability
}

type AgentRecord struct {
	AgentID              string
	InstanceID           string
	WorkspaceID          string
	ServerID             string
	CertificateSerial    string
	CertificateExpiresAt time.Time
	Status               string
	EnabledCapabilities  []agentv1.Capability
	SampleInterval       time.Duration
}

func NewStore(ctx context.Context, databaseURL string) (*Store, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database URL: %w", err)
	}
	poolConfig.MaxConns = 20
	poolConfig.MinConns = 2
	poolConfig.MaxConnLifetime = 30 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() {
	s.pool.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) ValidatePairingToken(ctx context.Context, token string, fallbackSampleInterval time.Duration) (PairingPolicy, error) {
	hash := sha256.Sum256([]byte(token))
	var policy PairingPolicy
	var planSampleMillis *int
	var agentMode bool
	err := s.pool.QueryRow(ctx, `
		SELECT token.workspace_id, token.server_id,
		       NULLIF(plan.entitlements->>'agentSampleIntervalMs', '')::int,
		       COALESCE((plan.entitlements->>'agentMode')::boolean, false)
		FROM agent_pairing_tokens token
		JOIN server_connections server ON server.id = token.server_id
		JOIN subscriptions subscription
		  ON subscription.workspace_id = token.workspace_id
		 AND subscription.status IN ('active', 'trialing')
		JOIN plans plan ON plan.code = subscription.plan_code
		WHERE token.token_hash = $1
		  AND token.used_at IS NULL
		  AND token.revoked_at IS NULL
		  AND token.expires_at > now()
		  AND server.connection_mode = 'agent'
		  AND server.workspace_id = token.workspace_id
	`, hash[:]).Scan(&policy.WorkspaceID, &policy.ServerID, &planSampleMillis, &agentMode)
	if errors.Is(err, pgx.ErrNoRows) || !agentMode {
		return PairingPolicy{}, ErrPairingTokenInvalid
	}
	if err != nil {
		return PairingPolicy{}, fmt.Errorf("validate pairing token: %w", err)
	}
	policy.SampleInterval = fallbackSampleInterval
	if planSampleMillis != nil {
		policy.SampleInterval = time.Duration(*planSampleMillis) * time.Millisecond
	}
	if policy.SampleInterval < 250*time.Millisecond {
		policy.SampleInterval = 250 * time.Millisecond
	}
	policy.EnabledCapabilities = []agentv1.Capability{
		agentv1.Capability_CAPABILITY_HOST_METRICS,
		agentv1.Capability_CAPABILITY_DOCKER_READ,
		agentv1.Capability_CAPABILITY_KUBERNETES_READ,
		agentv1.Capability_CAPABILITY_EBPF,
	}
	return policy, nil
}

func (s *Store) RegisterAgent(ctx context.Context, token string, policy PairingPolicy, registration AgentRegistration) error {
	hash := sha256.Sum256([]byte(token))
	capabilities, err := capabilityJSON(registration.Capabilities)
	if err != nil {
		return err
	}
	enabledCapabilities, err := capabilityJSON(policy.EnabledCapabilities)
	if err != nil {
		return err
	}

	transaction, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fmt.Errorf("begin pairing transaction: %w", err)
	}
	defer transaction.Rollback(ctx)

	command, err := transaction.Exec(ctx, `
		UPDATE agent_pairing_tokens
		SET used_at = now()
		WHERE token_hash = $1
		  AND workspace_id = $2
		  AND server_id = $3
		  AND used_at IS NULL
		  AND revoked_at IS NULL
		  AND expires_at > now()
	`, hash[:], policy.WorkspaceID, policy.ServerID)
	if err != nil {
		return fmt.Errorf("consume pairing token: %w", err)
	}
	if command.RowsAffected() != 1 {
		return ErrPairingTokenInvalid
	}

	_, err = transaction.Exec(ctx, `
		INSERT INTO agent_identities
		  (id, workspace_id, server_id, instance_id, certificate_serial,
		   certificate_expires_at, agent_version, operating_system, architecture,
		   kernel_version, capabilities, enabled_capabilities, status, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, 'paired', now())
		ON CONFLICT (server_id) DO UPDATE SET
		  id = EXCLUDED.id,
		  instance_id = EXCLUDED.instance_id,
		  certificate_serial = EXCLUDED.certificate_serial,
		  certificate_expires_at = EXCLUDED.certificate_expires_at,
		  agent_version = EXCLUDED.agent_version,
		  operating_system = EXCLUDED.operating_system,
		  architecture = EXCLUDED.architecture,
		  kernel_version = EXCLUDED.kernel_version,
		  capabilities = EXCLUDED.capabilities,
		  enabled_capabilities = EXCLUDED.enabled_capabilities,
		  ebpf_active = false,
		  connection_id = NULL,
		  boot_id = NULL,
		  last_acknowledged_sequence = 0,
		  last_seen_at = NULL,
		  last_heartbeat_at = NULL,
		  spool_bytes = 0,
		  spool_batches = 0,
		  status = 'paired',
		  revoked_at = NULL,
		  updated_at = now()
	`, registration.AgentID, policy.WorkspaceID, policy.ServerID, registration.InstanceID,
		registration.CertificateSerial, registration.CertificateExpiresAt, registration.Version,
		registration.OperatingSystem, registration.Architecture, registration.KernelVersion,
		capabilities, enabledCapabilities)
	if err != nil {
		return fmt.Errorf("register agent identity: %w", err)
	}
	_, err = transaction.Exec(ctx, `
		UPDATE server_connections
		SET status = 'pending', last_error_code = NULL, last_error_at = NULL, updated_at = now()
		WHERE id = $1 AND workspace_id = $2
	`, policy.ServerID, policy.WorkspaceID)
	if err != nil {
		return fmt.Errorf("update paired server: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit pairing transaction: %w", err)
	}
	return nil
}

func (s *Store) AgentByID(ctx context.Context, agentID, certificateSerial string) (AgentRecord, error) {
	var record AgentRecord
	var enabledJSON []byte
	var planSampleMillis *int
	err := s.pool.QueryRow(ctx, `
		SELECT identity.id, identity.instance_id, identity.workspace_id, identity.server_id,
		       identity.certificate_serial, identity.certificate_expires_at,
		       identity.status, identity.enabled_capabilities,
		       NULLIF(plan.entitlements->>'agentSampleIntervalMs', '')::int
		FROM agent_identities identity
		JOIN subscriptions subscription
		  ON subscription.workspace_id = identity.workspace_id
		 AND subscription.status IN ('active', 'trialing')
		JOIN plans plan ON plan.code = subscription.plan_code
		WHERE identity.id = $1 AND identity.revoked_at IS NULL
	`, agentID).Scan(&record.AgentID, &record.InstanceID, &record.WorkspaceID, &record.ServerID,
		&record.CertificateSerial, &record.CertificateExpiresAt, &record.Status, &enabledJSON, &planSampleMillis)
	if errors.Is(err, pgx.ErrNoRows) {
		return AgentRecord{}, ErrAgentUnauthorized
	}
	if err != nil {
		return AgentRecord{}, fmt.Errorf("load agent identity: %w", err)
	}
	if !strings.EqualFold(record.CertificateSerial, certificateSerial) || time.Now().After(record.CertificateExpiresAt) || record.Status == "revoked" {
		return AgentRecord{}, ErrAgentUnauthorized
	}
	record.EnabledCapabilities, err = parseCapabilityJSON(enabledJSON)
	if err != nil {
		return AgentRecord{}, err
	}
	record.SampleInterval = time.Second
	if planSampleMillis != nil {
		record.SampleInterval = time.Duration(*planSampleMillis) * time.Millisecond
	}
	if record.SampleInterval < 250*time.Millisecond {
		record.SampleInterval = 250 * time.Millisecond
	}
	return record, nil
}

func (s *Store) RotateAgentCertificate(ctx context.Context, agentID, oldSerial, newSerial string, expiresAt time.Time, version string, capabilities []agentv1.Capability) (AgentRecord, error) {
	record, err := s.AgentByID(ctx, agentID, oldSerial)
	if err != nil {
		return AgentRecord{}, err
	}
	capabilitiesJSON, err := capabilityJSON(capabilities)
	if err != nil {
		return AgentRecord{}, err
	}
	command, err := s.pool.Exec(ctx, `
		UPDATE agent_identities
		SET certificate_serial = $1, certificate_expires_at = $2,
		    agent_version = $3, capabilities = $4::jsonb, updated_at = now()
		WHERE id = $5 AND certificate_serial = $6 AND revoked_at IS NULL
	`, newSerial, expiresAt, version, capabilitiesJSON, agentID, oldSerial)
	if err != nil {
		return AgentRecord{}, fmt.Errorf("rotate agent certificate: %w", err)
	}
	if command.RowsAffected() != 1 {
		return AgentRecord{}, ErrAgentUnauthorized
	}
	record.CertificateSerial = newSerial
	record.CertificateExpiresAt = expiresAt
	return record, nil
}

func (s *Store) MarkConnected(ctx context.Context, record AgentRecord, hello *agentv1.AgentHello, connectionID string) error {
	capabilitiesJSON, err := capabilityJSON(hello.GetCapabilities())
	if err != nil {
		return err
	}
	transaction, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer transaction.Rollback(ctx)
	_, err = transaction.Exec(ctx, `
		UPDATE agent_identities
		SET agent_version = $1, operating_system = $2, architecture = $3,
		    kernel_version = $4, capabilities = $5::jsonb, ebpf_active = $6,
		    boot_id = $7, connection_id = $8, last_seen_at = now(), status = 'connected', updated_at = now()
		WHERE id = $9
	`, hello.GetAgentVersion(), hello.GetOperatingSystem(), hello.GetArchitecture(), hello.GetKernelVersion(),
		capabilitiesJSON, hello.GetEbpfActive(), hello.GetBootId(), connectionID, record.AgentID)
	if err != nil {
		return err
	}
	_, err = transaction.Exec(ctx, `
		UPDATE server_connections
		SET status = 'connected', last_seen_at = now(), last_error_code = NULL,
		    last_error_at = NULL, updated_at = now()
		WHERE id = $1 AND workspace_id = $2
	`, record.ServerID, record.WorkspaceID)
	if err != nil {
		return err
	}
	return transaction.Commit(ctx)
}

func (s *Store) SaveHeartbeat(ctx context.Context, record AgentRecord, heartbeat *agentv1.Heartbeat) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE agent_identities
		SET last_seen_at = now(), last_heartbeat_at = now(), spool_bytes = $1,
		    spool_batches = $2, status = 'connected', updated_at = now()
		WHERE id = $3
	`, clampUint64(heartbeat.GetSpoolBytes()), heartbeat.GetSpoolBatches(), record.AgentID)
	if err != nil {
		return fmt.Errorf("save heartbeat: %w", err)
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE server_connections SET status = 'connected', last_seen_at = now(), updated_at = now()
		WHERE id = $1 AND workspace_id = $2
	`, record.ServerID, record.WorkspaceID)
	return err
}

func (s *Store) MarkDisconnected(ctx context.Context, record AgentRecord, connectionID string) error {
	transaction, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer transaction.Rollback(ctx)
	command, err := transaction.Exec(ctx, `
		UPDATE agent_identities
		SET status = 'offline', connection_id = NULL, updated_at = now()
		WHERE id = $1 AND connection_id = $2 AND status <> 'revoked'
	`, record.AgentID, connectionID)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return transaction.Commit(ctx)
	}
	_, err = transaction.Exec(ctx, `
		UPDATE server_connections SET status = 'offline', updated_at = now()
		WHERE id = $1 AND workspace_id = $2
	`, record.ServerID, record.WorkspaceID)
	if err != nil {
		return err
	}
	return transaction.Commit(ctx)
}

func (s *Store) SaveMetricBatch(ctx context.Context, record AgentRecord, batch *agentv1.MetricBatch) (uint64, error) {
	if batch.GetAgentId() != record.AgentID {
		return 0, ErrAgentUnauthorized
	}
	samples := append([]*agentv1.SystemMetricSample(nil), batch.GetSamples()...)
	sort.Slice(samples, func(left, right int) bool { return samples[left].GetSequence() < samples[right].GetSequence() })
	throughSequence := uint64(0)
	for _, sample := range samples {
		if sample.GetSequence() > throughSequence {
			throughSequence = sample.GetSequence()
		}
	}
	if throughSequence == 0 && (len(batch.GetPods()) > 0 || len(batch.GetContainers()) > 0) {
		return 0, errors.New("inventory batch must include a system sample sequence")
	}

	transaction, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin metric transaction: %w", err)
	}
	defer transaction.Rollback(ctx)

	previous, err := loadPreviousNetwork(ctx, transaction, record.WorkspaceID, record.ServerID)
	if err != nil {
		return 0, err
	}
	for _, sample := range samples {
		current := networkSnapshotFromSample(sample)
		rxRate, txRate := networkRates(current, previous)
		inserted, err := insertSystemSample(ctx, transaction, record, batch.GetBootId(), sample, current, rxRate, txRate)
		if err != nil {
			return 0, err
		}
		if inserted {
			if err := upsertSystemRollup(ctx, transaction, record, sample, rxRate, txRate); err != nil {
				return 0, err
			}
		}
		previous = current
	}

	inventoryTime := timeFromUnixNanos(batch.GetInventorySampledAtUnixNanos())
	if inventoryTime.IsZero() && len(samples) > 0 {
		inventoryTime = timeFromUnixNanos(samples[len(samples)-1].GetSampledAtUnixNanos())
	}
	if inventoryTime.IsZero() {
		inventoryTime = time.Now().UTC()
	}
	if batch.GetInventorySampledAtUnixNanos() != 0 {
		_, err = transaction.Exec(ctx, `
			INSERT INTO server_inventory_snapshots
			  (workspace_id, server_id, sampled_at, pod_count, container_count, agent_sequence, boot_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (server_id, boot_id, agent_sequence) DO UPDATE SET
			  sampled_at = EXCLUDED.sampled_at,
			  pod_count = EXCLUDED.pod_count,
			  container_count = EXCLUDED.container_count
		`, record.WorkspaceID, record.ServerID, inventoryTime, len(batch.GetPods()), len(batch.GetContainers()),
			clampUint64(throughSequence), batch.GetBootId())
		if err != nil {
			return 0, fmt.Errorf("insert inventory snapshot: %w", err)
		}
	}
	if err := insertPodSamples(ctx, transaction, record, batch.GetBootId(), throughSequence, inventoryTime, batch.GetPods()); err != nil {
		return 0, err
	}
	if err := insertContainerSamples(ctx, transaction, record, batch.GetBootId(), throughSequence, inventoryTime, batch.GetContainers()); err != nil {
		return 0, err
	}

	_, err = transaction.Exec(ctx, `
		UPDATE agent_identities
		SET last_acknowledged_sequence = CASE
		      WHEN boot_id IS DISTINCT FROM $2 THEN $1
		      ELSE GREATEST(last_acknowledged_sequence, $1)
		    END,
		    boot_id = $2, last_seen_at = now(), status = 'connected', updated_at = now()
		WHERE id = $3
	`, clampUint64(throughSequence), batch.GetBootId(), record.AgentID)
	if err != nil {
		return 0, fmt.Errorf("update agent acknowledgement: %w", err)
	}
	_, err = transaction.Exec(ctx, `
		UPDATE server_connections SET status = 'connected', last_seen_at = now(), updated_at = now()
		WHERE id = $1 AND workspace_id = $2
	`, record.ServerID, record.WorkspaceID)
	if err != nil {
		return 0, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit metric transaction: %w", err)
	}
	return throughSequence, nil
}

type networkSnapshot struct {
	SampledAt     time.Time
	ReceiveTotal  uint64
	TransmitTotal uint64
}

func loadPreviousNetwork(ctx context.Context, transaction pgx.Tx, workspaceID, serverID string) (networkSnapshot, error) {
	var sampledAt time.Time
	var receiveTotal, transmitTotal int64
	err := transaction.QueryRow(ctx, `
		SELECT sampled_at, network_rx_total, network_tx_total
		FROM system_metric_samples
		WHERE workspace_id = $1 AND server_id = $2
		ORDER BY sampled_at DESC LIMIT 1
	`, workspaceID, serverID).Scan(&sampledAt, &receiveTotal, &transmitTotal)
	if errors.Is(err, pgx.ErrNoRows) {
		return networkSnapshot{}, nil
	}
	if err != nil {
		return networkSnapshot{}, fmt.Errorf("load previous network sample: %w", err)
	}
	return networkSnapshot{SampledAt: sampledAt, ReceiveTotal: uint64(max(receiveTotal, 0)), TransmitTotal: uint64(max(transmitTotal, 0))}, nil
}

func networkSnapshotFromSample(sample *agentv1.SystemMetricSample) networkSnapshot {
	current := networkSnapshot{SampledAt: timeFromUnixNanos(sample.GetSampledAtUnixNanos())}
	for _, network := range sample.GetNetworks() {
		current.ReceiveTotal += network.GetReceiveBytesTotal()
		current.TransmitTotal += network.GetTransmitBytesTotal()
	}
	return current
}

func networkRates(current, previous networkSnapshot) (float64, float64) {
	if previous.SampledAt.IsZero() || !current.SampledAt.After(previous.SampledAt) ||
		current.ReceiveTotal < previous.ReceiveTotal || current.TransmitTotal < previous.TransmitTotal {
		return 0, 0
	}
	seconds := current.SampledAt.Sub(previous.SampledAt).Seconds()
	return float64(current.ReceiveTotal-previous.ReceiveTotal) / seconds,
		float64(current.TransmitTotal-previous.TransmitTotal) / seconds
}

func insertSystemSample(ctx context.Context, transaction pgx.Tx, record AgentRecord, bootID string, sample *agentv1.SystemMetricSample, network networkSnapshot, rxRate, txRate float64) (bool, error) {
	diskPercent := aggregateDiskPercent(sample.GetDisks())
	ebpf := sample.GetEbpf()
	command, err := transaction.Exec(ctx, `
		INSERT INTO system_metric_samples
		  (workspace_id, server_id, sampled_at, cpu_percent, memory_percent, disk_percent,
		   network_rx_total, network_tx_total, network_rx_rate, network_tx_rate, uptime_seconds,
		   sample_source, agent_sequence, boot_id, monotonic_nanos, sample_interval_nanos,
		   collection_duration_nanos, load_average_1, load_average_5, load_average_15,
		   ebpf_active, scheduler_switches, tcp_retransmits)
		VALUES
		  ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
		   'agent', $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
		ON CONFLICT (server_id, boot_id, agent_sequence)
		  WHERE sample_source = 'agent' AND boot_id IS NOT NULL AND agent_sequence IS NOT NULL
		DO NOTHING
	`, record.WorkspaceID, record.ServerID, network.SampledAt, sample.GetCpuPercent(), sample.GetMemoryUsedPercent(),
		diskPercent, clampUint64(network.ReceiveTotal), clampUint64(network.TransmitTotal), rxRate, txRate,
		clampUint64(sample.GetUptimeSeconds()), clampUint64(sample.GetSequence()), bootID,
		fmt.Sprintf("%d", sample.GetMonotonicNanos()), clampUint64(sample.GetSampleIntervalNanos()),
		clampUint64(sample.GetCollectionDurationNanos()), sample.GetLoadAverage_1(), sample.GetLoadAverage_5(),
		sample.GetLoadAverage_15(), ebpf.GetActive(), clampUint64(ebpf.GetSchedulerSwitches()),
		clampUint64(ebpf.GetTcpRetransmits()))
	if err != nil {
		return false, fmt.Errorf("insert system metric sample: %w", err)
	}
	return command.RowsAffected() == 1, nil
}

func upsertSystemRollup(ctx context.Context, transaction pgx.Tx, record AgentRecord, sample *agentv1.SystemMetricSample, rxRate, txRate float64) error {
	diskPercent := aggregateDiskPercent(sample.GetDisks())
	ebpf := sample.GetEbpf()
	_, err := transaction.Exec(ctx, `
		INSERT INTO system_metric_rollups_1m
		  (workspace_id, server_id, bucket_at, sample_count,
		   cpu_average, cpu_minimum, cpu_maximum,
		   memory_average, memory_minimum, memory_maximum,
		   disk_average, network_rx_rate_average, network_tx_rate_average,
		   scheduler_switches_total, tcp_retransmits_total)
		VALUES ($1, $2, date_trunc('minute', $3::timestamptz), 1,
		        $4, $4, $4, $5, $5, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (workspace_id, server_id, bucket_at) DO UPDATE SET
		  cpu_average = ((system_metric_rollups_1m.cpu_average * system_metric_rollups_1m.sample_count) + EXCLUDED.cpu_average) / (system_metric_rollups_1m.sample_count + 1),
		  cpu_minimum = LEAST(system_metric_rollups_1m.cpu_minimum, EXCLUDED.cpu_minimum),
		  cpu_maximum = GREATEST(system_metric_rollups_1m.cpu_maximum, EXCLUDED.cpu_maximum),
		  memory_average = ((system_metric_rollups_1m.memory_average * system_metric_rollups_1m.sample_count) + EXCLUDED.memory_average) / (system_metric_rollups_1m.sample_count + 1),
		  memory_minimum = LEAST(system_metric_rollups_1m.memory_minimum, EXCLUDED.memory_minimum),
		  memory_maximum = GREATEST(system_metric_rollups_1m.memory_maximum, EXCLUDED.memory_maximum),
		  disk_average = ((system_metric_rollups_1m.disk_average * system_metric_rollups_1m.sample_count) + EXCLUDED.disk_average) / (system_metric_rollups_1m.sample_count + 1),
		  network_rx_rate_average = ((system_metric_rollups_1m.network_rx_rate_average * system_metric_rollups_1m.sample_count) + EXCLUDED.network_rx_rate_average) / (system_metric_rollups_1m.sample_count + 1),
		  network_tx_rate_average = ((system_metric_rollups_1m.network_tx_rate_average * system_metric_rollups_1m.sample_count) + EXCLUDED.network_tx_rate_average) / (system_metric_rollups_1m.sample_count + 1),
		  scheduler_switches_total = system_metric_rollups_1m.scheduler_switches_total + EXCLUDED.scheduler_switches_total,
		  tcp_retransmits_total = system_metric_rollups_1m.tcp_retransmits_total + EXCLUDED.tcp_retransmits_total,
		  sample_count = system_metric_rollups_1m.sample_count + 1
	`, record.WorkspaceID, record.ServerID, timeFromUnixNanos(sample.GetSampledAtUnixNanos()),
		sample.GetCpuPercent(), sample.GetMemoryUsedPercent(), diskPercent, rxRate, txRate,
		clampUint64(ebpf.GetSchedulerSwitches()), clampUint64(ebpf.GetTcpRetransmits()))
	if err != nil {
		return fmt.Errorf("upsert one-minute metric rollup: %w", err)
	}
	return nil
}

func insertPodSamples(ctx context.Context, transaction pgx.Tx, record AgentRecord, bootID string, sequence uint64, sampledAt time.Time, pods []*agentv1.KubernetesPodMetric) error {
	for _, pod := range pods {
		var previousAt time.Time
		var previousRX, previousTX int64
		err := transaction.QueryRow(ctx, `
			SELECT sampled_at, network_rx_total, network_tx_total
			FROM kubernetes_pod_samples
				WHERE workspace_id = $1 AND server_id = $2 AND namespace = $3 AND pod_name = $4
				ORDER BY sampled_at DESC LIMIT 1
			`, record.WorkspaceID, record.ServerID, pod.GetNamespace(), pod.GetName()).Scan(&previousAt, &previousRX, &previousTX)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		rxRate, txRate := counterRates(pod.GetNetworkReceiveBytesTotal(), pod.GetNetworkTransmitBytesTotal(), previousRX, previousTX, sampledAt.Sub(previousAt))
		_, err = transaction.Exec(ctx, `
			INSERT INTO kubernetes_pod_samples
			  (workspace_id, server_id, namespace, pod_name, node_name, phase, ready, restarts,
			   cpu_usage_millicores, cpu_request_millicores, cpu_limit_millicores,
			   memory_usage_bytes, memory_request_bytes, memory_limit_bytes,
			   network_rx_total, network_tx_total, network_rx_rate, network_tx_rate, sampled_at,
			   sample_source, agent_sequence, boot_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
			        $15, $16, $17, $18, $19, 'agent', $20, $21)
			ON CONFLICT (server_id, boot_id, agent_sequence, namespace, pod_name)
			  WHERE sample_source = 'agent' AND boot_id IS NOT NULL AND agent_sequence IS NOT NULL
			DO NOTHING
		`, record.WorkspaceID, record.ServerID, pod.GetNamespace(), pod.GetName(), pod.GetNode(), pod.GetPhase(),
			pod.GetReady(), pod.GetRestarts(), pod.GetCpuUsageMillicores(), pod.GetCpuRequestMillicores(),
			pod.GetCpuLimitMillicores(), clampUint64(pod.GetMemoryUsageBytes()), clampUint64(pod.GetMemoryRequestBytes()),
			clampUint64(pod.GetMemoryLimitBytes()), clampUint64(pod.GetNetworkReceiveBytesTotal()),
			clampUint64(pod.GetNetworkTransmitBytesTotal()), rxRate, txRate, sampledAt, clampUint64(sequence), bootID)
		if err != nil {
			return fmt.Errorf("insert Kubernetes pod sample: %w", err)
		}
	}
	return nil
}

func insertContainerSamples(ctx context.Context, transaction pgx.Tx, record AgentRecord, bootID string, sequence uint64, sampledAt time.Time, containers []*agentv1.DockerContainerMetric) error {
	for _, container := range containers {
		var previousAt time.Time
		var previousRX, previousTX int64
		err := transaction.QueryRow(ctx, `
			SELECT sampled_at, network_rx_total, network_tx_total
			FROM docker_container_samples
				WHERE workspace_id = $1 AND server_id = $2 AND container_id = $3
				ORDER BY sampled_at DESC LIMIT 1
			`, record.WorkspaceID, record.ServerID, container.GetId()).Scan(&previousAt, &previousRX, &previousTX)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		rxRate, txRate := counterRates(container.GetNetworkReceiveBytesTotal(), container.GetNetworkTransmitBytesTotal(), previousRX, previousTX, sampledAt.Sub(previousAt))
		_, err = transaction.Exec(ctx, `
			INSERT INTO docker_container_samples
			  (workspace_id, server_id, container_id, container_name, image, state, status,
			   cpu_percent, memory_usage_bytes, memory_limit_bytes,
			   network_rx_total, network_tx_total, network_rx_rate, network_tx_rate,
			   agent_sequence, boot_id, sampled_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
			ON CONFLICT (server_id, boot_id, agent_sequence, container_id) DO NOTHING
		`, record.WorkspaceID, record.ServerID, container.GetId(), container.GetName(), container.GetImage(),
			container.GetState(), container.GetStatus(), container.GetCpuPercent(),
			clampUint64(container.GetMemoryUsageBytes()), clampUint64(container.GetMemoryLimitBytes()),
			clampUint64(container.GetNetworkReceiveBytesTotal()), clampUint64(container.GetNetworkTransmitBytesTotal()),
			rxRate, txRate, clampUint64(sequence), bootID, sampledAt)
		if err != nil {
			return fmt.Errorf("insert Docker container sample: %w", err)
		}
	}
	return nil
}

func counterRates(currentRX, currentTX uint64, previousRX, previousTX int64, elapsed time.Duration) (float64, float64) {
	if elapsed <= 0 || previousRX < 0 || previousTX < 0 || currentRX < uint64(previousRX) || currentTX < uint64(previousTX) {
		return 0, 0
	}
	return float64(currentRX-uint64(previousRX)) / elapsed.Seconds(), float64(currentTX-uint64(previousTX)) / elapsed.Seconds()
}

func aggregateDiskPercent(disks []*agentv1.DiskMetric) float64 {
	for _, disk := range disks {
		if disk.GetMountpoint() == "/" {
			return boundedPercent(disk.GetUsedPercent())
		}
	}
	maximum := 0.0
	for _, disk := range disks {
		if value := boundedPercent(disk.GetUsedPercent()); value > maximum {
			maximum = value
		}
	}
	return maximum
}

func boundedPercent(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return 0
	}
	return min(value, 100)
}

func timeFromUnixNanos(value int64) time.Time {
	if value <= 0 {
		return time.Time{}
	}
	return time.Unix(0, value).UTC()
}

func clampUint64(value uint64) int64 {
	if value > math.MaxInt64 {
		return math.MaxInt64
	}
	return int64(value)
}

func capabilityJSON(capabilities []agentv1.Capability) ([]byte, error) {
	names := make([]string, 0, len(capabilities))
	seen := make(map[string]struct{}, len(capabilities))
	for _, capability := range capabilities {
		name := capability.String()
		if capability == agentv1.Capability_CAPABILITY_UNSPECIFIED {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}
		seen[name] = struct{}{}
		names = append(names, name)
	}
	sort.Strings(names)
	return json.Marshal(names)
}

func parseCapabilityJSON(value []byte) ([]agentv1.Capability, error) {
	var names []string
	if err := json.Unmarshal(value, &names); err != nil {
		return nil, fmt.Errorf("decode enabled agent capabilities: %w", err)
	}
	result := make([]agentv1.Capability, 0, len(names))
	for _, name := range names {
		if number, exists := agentv1.Capability_value[name]; exists {
			result = append(result, agentv1.Capability(number))
		}
	}
	return result, nil
}
