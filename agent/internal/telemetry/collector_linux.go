//go:build linux

package telemetry

import (
	"bufio"
	"context"
	"fmt"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	agentv1 "github.com/Rampesna/monitc/agent/gen/monitc/agent/v1"
	monitcebpf "github.com/Rampesna/monitc/agent/internal/ebpf"
	"golang.org/x/sys/unix"
)

type linuxCollector struct {
	metadata    HostMetadata
	ebpf        monitcebpf.Module
	previousCPU cpuTimes
}

type cpuTimes struct {
	Total uint64
	Idle  uint64
}

var ignoredFilesystems = map[string]struct{}{
	"autofs": {}, "bpf": {}, "cgroup": {}, "cgroup2": {}, "configfs": {}, "debugfs": {},
	"devpts": {}, "devtmpfs": {}, "efivarfs": {}, "fusectl": {}, "hugetlbfs": {}, "mqueue": {},
	"overlay": {}, "proc": {}, "pstore": {}, "securityfs": {}, "sysfs": {}, "tmpfs": {}, "tracefs": {},
}

func NewHostCollector(enableEBPF bool) (HostCollector, error) {
	metadata := RuntimeMetadata()
	metadata.Hostname, _ = os.Hostname()
	metadata.KernelVersion = strings.TrimSpace(readSmallFile("/proc/sys/kernel/osrelease", 512))
	metadata.BootID = strings.TrimSpace(readSmallFile("/proc/sys/kernel/random/boot_id", 128))
	if metadata.BootID == "" {
		return nil, fmt.Errorf("read Linux boot ID")
	}
	previous, err := readCPU()
	if err != nil {
		return nil, err
	}
	return &linuxCollector{metadata: metadata, ebpf: monitcebpf.New(enableEBPF), previousCPU: previous}, nil
}

func (c *linuxCollector) Metadata() HostMetadata { return c.metadata }

func (c *linuxCollector) EBPFActive() bool {
	return c.ebpf.Active()
}

func (c *linuxCollector) Close() error { return c.ebpf.Close() }

func (c *linuxCollector) Collect(ctx context.Context, sequence uint64, interval time.Duration) (*agentv1.SystemMetricSample, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	startedAt := time.Now().UTC()
	startedMonotonic := monotonicNanos()
	currentCPU, err := readCPU()
	if err != nil {
		return nil, err
	}
	cpuPercent := cpuUsage(c.previousCPU, currentCPU)
	c.previousCPU = currentCPU
	memoryTotal, memoryAvailable, err := readMemory()
	if err != nil {
		return nil, err
	}
	load1, load5, load15 := readLoadAverage()
	uptime := readUptime()
	disks := readDisks()
	networks := readNetworks()
	ebpfSnapshot := c.ebpf.Snapshot()
	finishedMonotonic := monotonicNanos()
	memoryUsed := memoryTotal - min(memoryTotal, memoryAvailable)
	memoryPercent := 0.0
	if memoryTotal > 0 {
		memoryPercent = float64(memoryUsed) * 100 / float64(memoryTotal)
	}
	return &agentv1.SystemMetricSample{
		Sequence:                sequence,
		SampledAtUnixNanos:      startedAt.UnixNano(),
		MonotonicNanos:          startedMonotonic,
		SampleIntervalNanos:     uint64(interval.Nanoseconds()),
		CollectionDurationNanos: finishedMonotonic - startedMonotonic,
		CpuPercent:              bounded(cpuPercent),
		LoadAverage_1:           load1,
		LoadAverage_5:           load5,
		LoadAverage_15:          load15,
		MemoryTotalBytes:        memoryTotal,
		MemoryUsedBytes:         memoryUsed,
		MemoryAvailableBytes:    memoryAvailable,
		MemoryUsedPercent:       bounded(memoryPercent),
		UptimeSeconds:           uptime,
		Disks:                   disks,
		Networks:                networks,
		Ebpf:                    ebpfProto(ebpfSnapshot),
	}, nil
}

func readCPU() (cpuTimes, error) {
	line := strings.TrimSpace(readSmallFile("/proc/stat", 4096))
	if newline := strings.IndexByte(line, '\n'); newline >= 0 {
		line = line[:newline]
	}
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return cpuTimes{}, fmt.Errorf("unexpected /proc/stat format")
	}
	values := make([]uint64, 0, len(fields)-1)
	for _, field := range fields[1:] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return cpuTimes{}, fmt.Errorf("parse /proc/stat: %w", err)
		}
		values = append(values, value)
	}
	var total uint64
	for _, value := range values {
		total += value
	}
	idle := values[3]
	if len(values) > 4 {
		idle += values[4]
	}
	return cpuTimes{Total: total, Idle: idle}, nil
}

func cpuUsage(previous, current cpuTimes) float64 {
	if current.Total <= previous.Total || current.Idle < previous.Idle {
		return 0
	}
	totalDelta := current.Total - previous.Total
	idleDelta := current.Idle - previous.Idle
	if idleDelta >= totalDelta {
		return 0
	}
	return float64(totalDelta-idleDelta) * 100 / float64(totalDelta)
}

func readMemory() (uint64, uint64, error) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0, err
	}
	defer file.Close()
	var total, available uint64
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		value, parseErr := strconv.ParseUint(fields[1], 10, 64)
		if parseErr != nil {
			continue
		}
		switch strings.TrimSuffix(fields[0], ":") {
		case "MemTotal":
			total = value * 1024
		case "MemAvailable":
			available = value * 1024
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, 0, err
	}
	if total == 0 {
		return 0, 0, fmt.Errorf("MemTotal is missing from /proc/meminfo")
	}
	return total, available, nil
}

func readLoadAverage() (float64, float64, float64) {
	fields := strings.Fields(readSmallFile("/proc/loadavg", 256))
	if len(fields) < 3 {
		return 0, 0, 0
	}
	one, _ := strconv.ParseFloat(fields[0], 64)
	five, _ := strconv.ParseFloat(fields[1], 64)
	fifteen, _ := strconv.ParseFloat(fields[2], 64)
	return one, five, fifteen
}

func readUptime() uint64 {
	fields := strings.Fields(readSmallFile("/proc/uptime", 128))
	if len(fields) == 0 {
		return 0
	}
	seconds, _ := strconv.ParseFloat(fields[0], 64)
	return uint64(max(seconds, 0))
}

func readDisks() []*agentv1.DiskMetric {
	file, err := os.Open("/proc/self/mounts")
	if err != nil {
		return nil
	}
	defer file.Close()
	seen := make(map[string]struct{})
	var disks []*agentv1.DiskMetric
	scanner := bufio.NewScanner(file)
	for scanner.Scan() && len(disks) < 256 {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 3 {
			continue
		}
		if _, ignored := ignoredFilesystems[fields[2]]; ignored {
			continue
		}
		mountpoint := decodeMountField(fields[1])
		if _, exists := seen[mountpoint]; exists {
			continue
		}
		seen[mountpoint] = struct{}{}
		var statistics unix.Statfs_t
		if err := unix.Statfs(mountpoint, &statistics); err != nil || statistics.Blocks == 0 {
			continue
		}
		total := statistics.Blocks * uint64(statistics.Bsize)
		free := statistics.Bfree * uint64(statistics.Bsize)
		available := statistics.Bavail * uint64(statistics.Bsize)
		used := total - min(total, free)
		disks = append(disks, &agentv1.DiskMetric{
			Device: decodeMountField(fields[0]), Mountpoint: mountpoint, Filesystem: fields[2],
			TotalBytes: total, UsedBytes: used, AvailableBytes: available,
			UsedPercent: float64(used) * 100 / float64(total),
		})
	}
	sort.Slice(disks, func(left, right int) bool { return disks[left].GetMountpoint() < disks[right].GetMountpoint() })
	return disks
}

func readNetworks() []*agentv1.NetworkMetric {
	file, err := os.Open("/proc/net/dev")
	if err != nil {
		return nil
	}
	defer file.Close()
	var networks []*agentv1.NetworkMetric
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		separator := strings.IndexByte(line, ':')
		if separator < 0 {
			continue
		}
		name := strings.TrimSpace(line[:separator])
		fields := strings.Fields(line[separator+1:])
		if len(fields) < 16 || name == "" {
			continue
		}
		values := make([]uint64, 16)
		valid := true
		for index := range values {
			values[index], err = strconv.ParseUint(fields[index], 10, 64)
			if err != nil {
				valid = false
				break
			}
		}
		if !valid {
			continue
		}
		networks = append(networks, &agentv1.NetworkMetric{
			Interface: name, ReceiveBytesTotal: values[0], ReceivePacketsTotal: values[1],
			ReceiveErrorsTotal: values[2], ReceiveDropsTotal: values[3],
			TransmitBytesTotal: values[8], TransmitPacketsTotal: values[9],
			TransmitErrorsTotal: values[10], TransmitDropsTotal: values[11],
		})
	}
	sort.Slice(networks, func(left, right int) bool { return networks[left].GetInterface() < networks[right].GetInterface() })
	return networks
}

func readSmallFile(path string, maximum int64) string {
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()
	buffer := make([]byte, maximum)
	count, _ := file.Read(buffer)
	return string(buffer[:count])
}

func monotonicNanos() uint64 {
	var clock unix.Timespec
	if err := unix.ClockGettime(unix.CLOCK_MONOTONIC, &clock); err != nil {
		return 0
	}
	return uint64(clock.Sec)*1_000_000_000 + uint64(clock.Nsec)
}

func decodeMountField(value string) string {
	replacer := strings.NewReplacer(`\040`, " ", `\011`, "\t", `\012`, "\n", `\134`, `\`)
	return replacer.Replace(value)
}

func bounded(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return 0
	}
	return min(value, 100)
}
