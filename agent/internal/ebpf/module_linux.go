//go:build linux

package ebpf

import (
	"fmt"
	"sync"

	cebpf "github.com/cilium/ebpf"
	"github.com/cilium/ebpf/asm"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/rlimit"
	"golang.org/x/sys/unix"
)

const (
	schedulerCounter  uint32 = 0
	retransmitCounter uint32 = 1
)

type linuxModule struct {
	mu                  sync.Mutex
	counters            *cebpf.Map
	lastEvent           *cebpf.Map
	programs            []*cebpf.Program
	links               []link.Link
	previousScheduler   uint64
	previousRetransmits uint64
	previousWindow      uint64
	partialReason       string
}

func New(enabled bool) Module {
	if !enabled {
		return Disabled("disabled by configuration")
	}
	module, err := newLinuxModule()
	if err != nil {
		return Disabled(safeReason(err))
	}
	return module
}

func newLinuxModule() (*linuxModule, error) {
	if err := rlimit.RemoveMemlock(); err != nil {
		return nil, fmt.Errorf("memlock capability unavailable: %w", err)
	}
	counters, err := cebpf.NewMap(&cebpf.MapSpec{
		Name: "monitc_counts", Type: cebpf.Array, KeySize: 4, ValueSize: 8, MaxEntries: 2,
	})
	if err != nil {
		return nil, fmt.Errorf("create eBPF counter map: %w", err)
	}
	lastEvent, err := cebpf.NewMap(&cebpf.MapSpec{
		Name: "monitc_last", Type: cebpf.Array, KeySize: 4, ValueSize: 8, MaxEntries: 1,
	})
	if err != nil {
		counters.Close()
		return nil, fmt.Errorf("create eBPF event clock map: %w", err)
	}
	module := &linuxModule{counters: counters, lastEvent: lastEvent, previousWindow: monotonicNanos()}
	schedulerProgram, err := newCounterProgram("monitc_sched", counters, lastEvent, schedulerCounter)
	if err != nil {
		module.Close()
		return nil, fmt.Errorf("load scheduler tracepoint program: %w", err)
	}
	module.programs = append(module.programs, schedulerProgram)
	schedulerLink, err := link.Tracepoint("sched", "sched_switch", schedulerProgram, nil)
	if err != nil {
		module.Close()
		return nil, fmt.Errorf("attach scheduler tracepoint: %w", err)
	}
	module.links = append(module.links, schedulerLink)

	retransmitProgram, err := newCounterProgram("monitc_retx", counters, lastEvent, retransmitCounter)
	if err == nil {
		module.programs = append(module.programs, retransmitProgram)
		if retransmitLink, attachErr := link.Tracepoint("tcp", "tcp_retransmit_skb", retransmitProgram, nil); attachErr == nil {
			module.links = append(module.links, retransmitLink)
		} else {
			module.partialReason = "TCP retransmit tracepoint unavailable"
		}
	} else {
		module.partialReason = "TCP retransmit program unavailable"
	}
	return module, nil
}

func newCounterProgram(name string, counters, lastEvent *cebpf.Map, key uint32) (*cebpf.Program, error) {
	instructions := asm.Instructions{
		asm.StoreImm(asm.RFP, -4, int64(key), asm.Word),
		asm.LoadMapPtr(asm.R1, counters.FD()),
		asm.Mov.Reg(asm.R2, asm.RFP),
		asm.Add.Imm(asm.R2, -4),
		asm.FnMapLookupElem.Call(),
		asm.JEq.Imm(asm.R0, 0, "exit"),
		asm.Mov.Imm(asm.R1, 1),
		asm.StoreXAdd(asm.R0, asm.R1, asm.DWord),
		asm.FnKtimeGetNs.Call(),
		asm.Mov.Reg(asm.R6, asm.R0),
		asm.StoreImm(asm.RFP, -4, 0, asm.Word),
		asm.LoadMapPtr(asm.R1, lastEvent.FD()),
		asm.Mov.Reg(asm.R2, asm.RFP),
		asm.Add.Imm(asm.R2, -4),
		asm.FnMapLookupElem.Call(),
		asm.JEq.Imm(asm.R0, 0, "exit"),
		asm.StoreMem(asm.R0, 0, asm.R6, asm.DWord),
		asm.Mov.Imm(asm.R0, 0).WithSymbol("exit"),
		asm.Return(),
	}
	return cebpf.NewProgram(&cebpf.ProgramSpec{
		Name: name, Type: cebpf.TracePoint, License: "GPL", Instructions: instructions,
	})
}

func (m *linuxModule) Snapshot() Snapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := monotonicNanos()
	var scheduler, retransmits, last uint64
	if err := m.counters.Lookup(schedulerCounter, &scheduler); err != nil {
		return Snapshot{UnavailableReason: "eBPF counter read failed"}
	}
	if err := m.counters.Lookup(retransmitCounter, &retransmits); err != nil {
		return Snapshot{UnavailableReason: "eBPF counter read failed"}
	}
	_ = m.lastEvent.Lookup(uint32(0), &last)
	snapshot := Snapshot{
		Active:                    true,
		WindowStartMonotonicNanos: m.previousWindow,
		WindowEndMonotonicNanos:   now,
		SchedulerSwitches:         deltaCounter(scheduler, m.previousScheduler),
		TCPRetransmits:            deltaCounter(retransmits, m.previousRetransmits),
		LastEventMonotonicNanos:   last,
		UnavailableReason:         m.partialReason,
	}
	m.previousWindow = now
	m.previousScheduler = scheduler
	m.previousRetransmits = retransmits
	return snapshot
}

func (m *linuxModule) Active() bool { return true }

func (m *linuxModule) Close() error {
	for _, attached := range m.links {
		_ = attached.Close()
	}
	for _, program := range m.programs {
		_ = program.Close()
	}
	if m.counters != nil {
		_ = m.counters.Close()
	}
	if m.lastEvent != nil {
		_ = m.lastEvent.Close()
	}
	return nil
}

func monotonicNanos() uint64 {
	var clock unix.Timespec
	if err := unix.ClockGettime(unix.CLOCK_MONOTONIC, &clock); err != nil {
		return 0
	}
	return uint64(clock.Sec)*1_000_000_000 + uint64(clock.Nsec)
}

func deltaCounter(current, previous uint64) uint64 {
	if current < previous {
		return current
	}
	return current - previous
}

func safeReason(err error) string {
	if err == nil {
		return "eBPF unavailable"
	}
	return fmt.Sprintf("eBPF unavailable: %.160s", err.Error())
}
