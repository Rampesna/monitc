package gateway

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	agentv1 "github.com/Rampesna/monitc/agent/gen/monitc/agent/v1"
	"github.com/google/uuid"
)

const (
	maximumSamplesPerBatch     = 1000
	maximumInventoryPerBatch   = 5000
	maximumMetricClockSkew     = 5 * time.Minute
	maximumOfflineSampleAge    = 30 * 24 * time.Hour
	maximumEBPFEventClockLead  = time.Second
	maximumInventoryFieldBytes = 1024
	maximumAgentCapabilities   = 16
)

func validateAgentHello(record AgentRecord, hello *agentv1.AgentHello) error {
	if hello == nil || hello.GetAgentId() != record.AgentID || hello.GetInstanceId() != record.InstanceID {
		return ErrAgentUnauthorized
	}
	if _, err := uuid.Parse(hello.GetBootId()); err != nil {
		return errors.New("hello boot_id must be a UUID")
	}
	if !validAgentMetadata(hello.GetHostname(), hello.GetOperatingSystem(), hello.GetArchitecture(),
		hello.GetKernelVersion(), hello.GetAgentVersion()) {
		return errors.New("hello metadata is invalid")
	}
	if err := validateCapabilities(hello.GetCapabilities()); err != nil {
		return err
	}
	if hello.GetEbpfActive() && !containsCapability(hello.GetCapabilities(), agentv1.Capability_CAPABILITY_EBPF) {
		return errors.New("hello reports active eBPF without the capability")
	}
	return nil
}

func validateHeartbeat(record AgentRecord, heartbeat *agentv1.Heartbeat, now time.Time) error {
	if heartbeat == nil || heartbeat.GetAgentId() != record.AgentID {
		return ErrAgentUnauthorized
	}
	sentAt := timeFromUnixNanos(heartbeat.GetSentAtUnixNanos())
	if sentAt.IsZero() || sentAt.After(now.Add(maximumMetricClockSkew)) || sentAt.Before(now.Add(-maximumMetricClockSkew)) {
		return errors.New("heartbeat timestamp is outside the accepted window")
	}
	if heartbeat.GetSpoolBytes() > 16<<30 || heartbeat.GetSpoolBatches() > 1_000_000 {
		return errors.New("heartbeat spool state exceeds the accepted limit")
	}
	return nil
}

func validAgentMetadata(hostname, operatingSystem, architecture, kernelVersion, version string) bool {
	return validOptionalFieldLimit(hostname, 255) &&
		validFieldLimit(operatingSystem, 32) &&
		validFieldLimit(architecture, 32) &&
		validOptionalFieldLimit(kernelVersion, 128) &&
		validFieldLimit(version, 64)
}

func validateCapabilities(capabilities []agentv1.Capability) error {
	if len(capabilities) == 0 || len(capabilities) > maximumAgentCapabilities {
		return errors.New("agent capabilities are invalid")
	}
	seen := make(map[agentv1.Capability]struct{}, len(capabilities))
	for _, capability := range capabilities {
		if capability <= agentv1.Capability_CAPABILITY_UNSPECIFIED || capability > agentv1.Capability_CAPABILITY_SELF_UPDATE {
			return errors.New("agent capability is unknown")
		}
		if _, duplicate := seen[capability]; duplicate {
			return errors.New("agent capability is duplicated")
		}
		seen[capability] = struct{}{}
	}
	return nil
}

func containsCapability(capabilities []agentv1.Capability, expected agentv1.Capability) bool {
	for _, capability := range capabilities {
		if capability == expected {
			return true
		}
	}
	return false
}

func validateMetricBatch(record AgentRecord, batch *agentv1.MetricBatch, now time.Time) error {
	if batch == nil || batch.GetAgentId() != record.AgentID {
		return ErrAgentUnauthorized
	}
	if _, err := uuid.Parse(batch.GetBootId()); err != nil {
		return errors.New("boot_id must be a UUID")
	}
	if len(batch.GetSamples()) == 0 || len(batch.GetSamples()) > maximumSamplesPerBatch {
		return fmt.Errorf("sample count must be between 1 and %d", maximumSamplesPerBatch)
	}
	if len(batch.GetPods()) > maximumInventoryPerBatch || len(batch.GetContainers()) > maximumInventoryPerBatch {
		return errors.New("inventory count exceeds the batch limit")
	}
	if !hasCapability(record, agentv1.Capability_CAPABILITY_HOST_METRICS) {
		return errors.New("host metric capability is not enabled")
	}
	if len(batch.GetPods()) > 0 && !hasCapability(record, agentv1.Capability_CAPABILITY_KUBERNETES_READ) {
		return errors.New("Kubernetes capability is not enabled")
	}
	if len(batch.GetContainers()) > 0 && !hasCapability(record, agentv1.Capability_CAPABILITY_DOCKER_READ) {
		return errors.New("Docker capability is not enabled")
	}
	seenSequences := make(map[uint64]struct{}, len(batch.GetSamples()))
	for _, sample := range batch.GetSamples() {
		if sample == nil || sample.GetSequence() == 0 {
			return errors.New("sample sequence must be positive")
		}
		if _, duplicate := seenSequences[sample.GetSequence()]; duplicate {
			return errors.New("sample sequence is duplicated")
		}
		seenSequences[sample.GetSequence()] = struct{}{}
		sampledAt := timeFromUnixNanos(sample.GetSampledAtUnixNanos())
		if sampledAt.IsZero() || sampledAt.After(now.Add(maximumMetricClockSkew)) ||
			sampledAt.Before(now.Add(-maximumOfflineSampleAge)) {
			return errors.New("sample timestamp is outside the accepted window")
		}
		if sample.GetSampleIntervalNanos() < uint64((250*time.Millisecond).Nanoseconds()) ||
			sample.GetSampleIntervalNanos() > uint64(time.Minute.Nanoseconds()) {
			return errors.New("sample interval is outside the accepted range")
		}
		if sample.GetCollectionDurationNanos() > uint64((5 * time.Minute).Nanoseconds()) {
			return errors.New("collection duration exceeds the accepted range")
		}
		for _, value := range []float64{sample.GetCpuPercent(), sample.GetMemoryUsedPercent()} {
			if !validPercent(value) {
				return errors.New("sample percentage is invalid")
			}
		}
		for _, value := range []float64{sample.GetLoadAverage_1(), sample.GetLoadAverage_5(), sample.GetLoadAverage_15()} {
			if !validRange(value, 0, 1_000_000) {
				return errors.New("load average is invalid")
			}
		}
		if len(sample.GetDisks()) > 512 || len(sample.GetNetworks()) > 512 {
			return errors.New("host inventory exceeds the accepted limit")
		}
		for _, disk := range sample.GetDisks() {
			if disk == nil || !validPercent(disk.GetUsedPercent()) ||
				!validField(disk.GetDevice()) || !validField(disk.GetMountpoint()) || !validField(disk.GetFilesystem()) {
				return errors.New("disk metric is invalid")
			}
		}
		for _, network := range sample.GetNetworks() {
			if network == nil || !validField(network.GetInterface()) {
				return errors.New("network metric is invalid")
			}
		}
		if ebpf := sample.GetEbpf(); ebpf != nil {
			if ebpf.GetActive() && !hasCapability(record, agentv1.Capability_CAPABILITY_EBPF) {
				return errors.New("eBPF telemetry capability is not enabled")
			}
			lastEvent, windowEnd := ebpf.GetLastEventMonotonicNanos(), ebpf.GetWindowEndMonotonicNanos()
			eventClockLead := uint64(0)
			if lastEvent > windowEnd {
				eventClockLead = lastEvent - windowEnd
			}
			if !validOptionalField(ebpf.GetUnavailableReason()) ||
				windowEnd < ebpf.GetWindowStartMonotonicNanos() ||
				eventClockLead > uint64(maximumEBPFEventClockLead.Nanoseconds()) {
				return errors.New("eBPF aggregate is invalid")
			}
		}
	}
	if value := batch.GetInventorySampledAtUnixNanos(); value != 0 {
		inventoryAt := timeFromUnixNanos(value)
		if inventoryAt.IsZero() || inventoryAt.After(now.Add(maximumMetricClockSkew)) ||
			inventoryAt.Before(now.Add(-maximumOfflineSampleAge)) {
			return errors.New("inventory timestamp is outside the accepted window")
		}
	}
	for _, pod := range batch.GetPods() {
		if pod == nil || !validField(pod.GetNamespace()) || !validField(pod.GetName()) ||
			!validOptionalField(pod.GetNode()) || !validField(pod.GetPhase()) || !validField(pod.GetReady()) ||
			!validRange(pod.GetCpuUsageMillicores(), 0, 1_000_000_000) ||
			!validRange(pod.GetCpuRequestMillicores(), 0, 1_000_000_000) ||
			!validRange(pod.GetCpuLimitMillicores(), 0, 1_000_000_000) {
			return errors.New("Kubernetes pod metric is invalid")
		}
	}
	for _, container := range batch.GetContainers() {
		if container == nil || !validField(container.GetId()) || !validField(container.GetName()) ||
			!validField(container.GetImage()) || !validField(container.GetState()) ||
			!validOptionalField(container.GetStatus()) || !validRange(container.GetCpuPercent(), 0, 100_000) {
			return errors.New("Docker container metric is invalid")
		}
	}
	return nil
}

func hasCapability(record AgentRecord, capability agentv1.Capability) bool {
	for _, enabled := range record.EnabledCapabilities {
		if enabled == capability {
			return true
		}
	}
	return false
}

func validPercent(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= 100
}

func validNonnegative(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0
}

func validRange(value, minimum, maximum float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= minimum && value <= maximum
}

func validField(value string) bool {
	return len(value) > 0 && len(value) <= maximumInventoryFieldBytes &&
		!strings.ContainsRune(value, '\x00')
}

func validOptionalField(value string) bool {
	return len(value) <= maximumInventoryFieldBytes && !strings.ContainsRune(value, '\x00')
}

func validFieldLimit(value string, maximum int) bool {
	value = strings.TrimSpace(value)
	return value != "" && validOptionalFieldLimit(value, maximum)
}

func validOptionalFieldLimit(value string, maximum int) bool {
	return len(value) <= maximum && utf8.ValidString(value) && !strings.ContainsRune(value, '\x00') &&
		!strings.ContainsFunc(value, func(character rune) bool { return character < 0x20 || character == 0x7f })
}
