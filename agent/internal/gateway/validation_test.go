package gateway

import (
	"math"
	"testing"
	"time"

	agentv1 "github.com/Rampesna/monitc/agent/gen/monitc/agent/v1"
	"google.golang.org/protobuf/proto"
)

func TestValidateMetricBatchEnforcesIdentityCapabilitiesAndRanges(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	record := AgentRecord{
		AgentID: "11111111-2222-4333-8444-555555555555",
		EnabledCapabilities: []agentv1.Capability{
			agentv1.Capability_CAPABILITY_HOST_METRICS,
			agentv1.Capability_CAPABILITY_KUBERNETES_READ,
		},
	}
	valid := &agentv1.MetricBatch{
		AgentId: record.AgentID,
		BootId:  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
		Samples: []*agentv1.SystemMetricSample{{
			Sequence: 1, SampledAtUnixNanos: now.UnixNano(),
			SampleIntervalNanos: uint64(time.Second), CollectionDurationNanos: uint64(time.Millisecond),
			CpuPercent: 12.5, MemoryUsedPercent: 40,
		}},
		Pods: []*agentv1.KubernetesPodMetric{{
			Namespace: "default", Name: "api", Phase: "Running", Ready: "1/1",
		}},
	}
	if err := validateMetricBatch(record, valid, now); err != nil {
		t.Fatalf("valid metric batch was rejected: %v", err)
	}

	invalidPercent := cloneMetricBatch(valid)
	invalidPercent.Samples[0].CpuPercent = math.NaN()
	if err := validateMetricBatch(record, invalidPercent, now); err == nil {
		t.Fatal("NaN metric percentage should be rejected")
	}

	unauthorizedDocker := cloneMetricBatch(valid)
	unauthorizedDocker.Containers = []*agentv1.DockerContainerMetric{{
		Id: "container-id", Name: "api", Image: "api:latest", State: "running",
	}}
	if err := validateMetricBatch(record, unauthorizedDocker, now); err == nil {
		t.Fatal("inventory without an enabled capability should be rejected")
	}
}

func TestValidateAgentHelloAndHeartbeatBoundUntrustedMetadata(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	record := AgentRecord{
		AgentID:     "11111111-2222-4333-8444-555555555555",
		InstanceID:  "66666666-7777-4888-8999-aaaaaaaaaaaa",
		WorkspaceID: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
	}
	hello := &agentv1.AgentHello{
		AgentId: record.AgentID, InstanceId: record.InstanceID,
		Hostname: "production-1", OperatingSystem: "linux", Architecture: "amd64",
		KernelVersion: "6.8.0", AgentVersion: "1.5.0",
		BootId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
		Capabilities: []agentv1.Capability{
			agentv1.Capability_CAPABILITY_HOST_METRICS,
			agentv1.Capability_CAPABILITY_EBPF,
		},
		EbpfActive: true,
	}
	if err := validateAgentHello(record, hello); err != nil {
		t.Fatalf("valid hello was rejected: %v", err)
	}
	invalid := proto.Clone(hello).(*agentv1.AgentHello)
	invalid.Capabilities = append(invalid.Capabilities, agentv1.Capability_CAPABILITY_EBPF)
	if err := validateAgentHello(record, invalid); err == nil {
		t.Fatal("duplicated capabilities should be rejected")
	}
	heartbeat := &agentv1.Heartbeat{
		AgentId: record.AgentID, SentAtUnixNanos: now.UnixNano(),
		SpoolBytes: 256 << 20, SpoolBatches: 128,
	}
	if err := validateHeartbeat(record, heartbeat, now); err != nil {
		t.Fatalf("valid heartbeat was rejected: %v", err)
	}
	heartbeat.SentAtUnixNanos = now.Add(-time.Hour).UnixNano()
	if err := validateHeartbeat(record, heartbeat, now); err == nil {
		t.Fatal("stale heartbeat should be rejected")
	}
}

func TestDockerCPUAllowsMultiCorePercentages(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	record := AgentRecord{
		AgentID: "11111111-2222-4333-8444-555555555555",
		EnabledCapabilities: []agentv1.Capability{
			agentv1.Capability_CAPABILITY_HOST_METRICS,
			agentv1.Capability_CAPABILITY_DOCKER_READ,
		},
	}
	batch := &agentv1.MetricBatch{
		AgentId: record.AgentID,
		BootId:  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
		Samples: []*agentv1.SystemMetricSample{{
			Sequence: 1, SampledAtUnixNanos: now.UnixNano(),
			SampleIntervalNanos: uint64(time.Second),
		}},
		Containers: []*agentv1.DockerContainerMetric{{
			Id: "abcdef", Name: "api", Image: "api:latest", State: "running", CpuPercent: 375,
		}},
	}
	if err := validateMetricBatch(record, batch, now); err != nil {
		t.Fatalf("multi-core Docker CPU percentage was rejected: %v", err)
	}
}

func cloneMetricBatch(source *agentv1.MetricBatch) *agentv1.MetricBatch {
	return proto.Clone(source).(*agentv1.MetricBatch)
}
