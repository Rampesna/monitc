package telemetry

import (
	"context"
	"errors"
	"runtime"
	"time"

	agentv1 "github.com/Rampesna/monitc/agent/gen/monitc/agent/v1"
	monitcebpf "github.com/Rampesna/monitc/agent/internal/ebpf"
)

var ErrUnsupported = errors.New("native host telemetry is supported only on Linux")

type HostMetadata struct {
	Hostname        string
	OperatingSystem string
	Architecture    string
	KernelVersion   string
	BootID          string
}

type HostCollector interface {
	Collect(context.Context, uint64, time.Duration) (*agentv1.SystemMetricSample, error)
	Metadata() HostMetadata
	EBPFActive() bool
	Close() error
}

func RuntimeMetadata() HostMetadata {
	return HostMetadata{OperatingSystem: runtime.GOOS, Architecture: runtime.GOARCH}
}

func ebpfProto(snapshot monitcebpf.Snapshot) *agentv1.EbpfAggregate {
	return &agentv1.EbpfAggregate{
		Active:                    snapshot.Active,
		WindowStartMonotonicNanos: snapshot.WindowStartMonotonicNanos,
		WindowEndMonotonicNanos:   snapshot.WindowEndMonotonicNanos,
		SchedulerSwitches:         snapshot.SchedulerSwitches,
		TcpRetransmits:            snapshot.TCPRetransmits,
		LastEventMonotonicNanos:   snapshot.LastEventMonotonicNanos,
		UnavailableReason:         snapshot.UnavailableReason,
	}
}
