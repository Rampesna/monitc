package telemetry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	agentv1 "github.com/Rampesna/monitc/agent/gen/monitc/agent/v1"
)

type DockerCollector struct {
	client *http.Client
}

type dockerContainer struct {
	ID     string   `json:"Id"`
	Names  []string `json:"Names"`
	Image  string   `json:"Image"`
	State  string   `json:"State"`
	Status string   `json:"Status"`
}

type dockerStats struct {
	CPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
		OnlineCPUs     uint32 `json:"online_cpus"`
	} `json:"cpu_stats"`
	PreCPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
	} `json:"precpu_stats"`
	MemoryStats struct {
		Usage uint64            `json:"usage"`
		Limit uint64            `json:"limit"`
		Stats map[string]uint64 `json:"stats"`
	} `json:"memory_stats"`
	Networks map[string]struct {
		RXBytes uint64 `json:"rx_bytes"`
		TXBytes uint64 `json:"tx_bytes"`
	} `json:"networks"`
}

func NewDockerCollector(socketPath string) *DockerCollector {
	transport := &http.Transport{
		DisableCompression: true,
		MaxIdleConns:       8,
		IdleConnTimeout:    30 * time.Second,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 2 * time.Second}).DialContext(ctx, "unix", socketPath)
		},
	}
	return &DockerCollector{client: &http.Client{Transport: transport, Timeout: 5 * time.Second}}
}

func (c *DockerCollector) Available(ctx context.Context) bool {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker/_ping", nil)
	response, err := c.client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode == http.StatusOK
}

func (c *DockerCollector) Collect(ctx context.Context) ([]*agentv1.DockerContainerMetric, error) {
	var containers []dockerContainer
	if err := c.getJSON(ctx, "/containers/json?all=1", &containers); err != nil {
		return nil, err
	}
	result := make([]*agentv1.DockerContainerMetric, len(containers))
	semaphore := make(chan struct{}, 4)
	var wait sync.WaitGroup
	for index, container := range containers {
		index, container := index, container
		result[index] = basicContainerMetric(container)
		if container.State != "running" {
			continue
		}
		wait.Add(1)
		go func() {
			defer wait.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				return
			}
			var statistics dockerStats
			path := "/containers/" + url.PathEscape(container.ID) + "/stats?stream=false&one-shot=true"
			if err := c.getJSON(ctx, path, &statistics); err != nil {
				return
			}
			applyDockerStats(result[index], statistics)
		}()
	}
	wait.Wait()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (c *DockerCollector) getJSON(ctx context.Context, path string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://docker"+path, nil)
	if err != nil {
		return err
	}
	response, err := c.client.Do(request)
	if err != nil {
		return fmt.Errorf("Docker API request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return fmt.Errorf("Docker API returned HTTP %d", response.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 16<<20))
	if err := decoder.Decode(target); err != nil {
		if errors.Is(err, io.EOF) {
			return errors.New("Docker API returned an empty response")
		}
		return fmt.Errorf("decode Docker API response: %w", err)
	}
	return nil
}

func basicContainerMetric(container dockerContainer) *agentv1.DockerContainerMetric {
	name := container.ID
	if len(container.Names) > 0 {
		name = strings.TrimPrefix(container.Names[0], "/")
	}
	return &agentv1.DockerContainerMetric{
		Id: container.ID, Name: name, Image: container.Image, State: container.State, Status: container.Status,
	}
}

func applyDockerStats(metric *agentv1.DockerContainerMetric, statistics dockerStats) {
	cpuDelta := statistics.CPUStats.CPUUsage.TotalUsage - min(statistics.CPUStats.CPUUsage.TotalUsage, statistics.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := statistics.CPUStats.SystemCPUUsage - min(statistics.CPUStats.SystemCPUUsage, statistics.PreCPUStats.SystemCPUUsage)
	processors := statistics.CPUStats.OnlineCPUs
	if processors == 0 {
		processors = 1
	}
	if systemDelta > 0 {
		metric.CpuPercent = float64(cpuDelta) / float64(systemDelta) * float64(processors) * 100
	}
	cache := statistics.MemoryStats.Stats["inactive_file"]
	metric.MemoryUsageBytes = statistics.MemoryStats.Usage - min(statistics.MemoryStats.Usage, cache)
	metric.MemoryLimitBytes = statistics.MemoryStats.Limit
	for _, network := range statistics.Networks {
		metric.NetworkReceiveBytesTotal += network.RXBytes
		metric.NetworkTransmitBytesTotal += network.TXBytes
	}
}
