//go:build !linux

package ebpf

func New(enabled bool) Module {
	if !enabled {
		return Disabled("disabled by configuration")
	}
	return Disabled("eBPF telemetry is supported only on Linux")
}
