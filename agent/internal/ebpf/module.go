package ebpf

import "time"

type Snapshot struct {
	Active                    bool
	WindowStartMonotonicNanos uint64
	WindowEndMonotonicNanos   uint64
	SchedulerSwitches         uint64
	TCPRetransmits            uint64
	LastEventMonotonicNanos   uint64
	UnavailableReason         string
}

type Module interface {
	Active() bool
	Snapshot() Snapshot
	Close() error
}

type disabledModule struct {
	reason  string
	started time.Time
}

func Disabled(reason string) Module {
	return &disabledModule{reason: reason, started: time.Now()}
}

func (d *disabledModule) Snapshot() Snapshot {
	return Snapshot{UnavailableReason: d.reason}
}

func (d *disabledModule) Active() bool { return false }

func (d *disabledModule) Close() error {
	return nil
}
