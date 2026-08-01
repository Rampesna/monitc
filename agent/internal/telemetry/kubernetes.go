package telemetry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	agentv1 "github.com/Rampesna/monitc/agent/gen/monitc/agent/v1"
)

type KubernetesCollector struct {
	command    string
	kubeconfig string
}

type kubernetesPodList struct {
	Items []struct {
		Metadata struct {
			Namespace string `json:"namespace"`
			Name      string `json:"name"`
		} `json:"metadata"`
		Spec struct {
			NodeName   string `json:"nodeName"`
			Containers []struct {
				Resources struct {
					Requests map[string]string `json:"requests"`
					Limits   map[string]string `json:"limits"`
				} `json:"resources"`
			} `json:"containers"`
		} `json:"spec"`
		Status struct {
			Phase             string `json:"phase"`
			ContainerStatuses []struct {
				Ready        bool   `json:"ready"`
				RestartCount uint32 `json:"restartCount"`
			} `json:"containerStatuses"`
		} `json:"status"`
	} `json:"items"`
}

type kubernetesMetricList struct {
	Items []struct {
		Metadata struct {
			Namespace string `json:"namespace"`
			Name      string `json:"name"`
		} `json:"metadata"`
		Containers []struct {
			Usage map[string]string `json:"usage"`
		} `json:"containers"`
	} `json:"items"`
}

type podUsage struct {
	cpuMillicores float64
	memoryBytes   uint64
}

type podNetwork struct {
	receiveBytes  uint64
	transmitBytes uint64
}

type kubeletSummary struct {
	Pods []struct {
		PodRef struct {
			Namespace string `json:"namespace"`
			Name      string `json:"name"`
		} `json:"podRef"`
		Network struct {
			RXBytes    *uint64 `json:"rxBytes"`
			TXBytes    *uint64 `json:"txBytes"`
			Interfaces []struct {
				RXBytes *uint64 `json:"rxBytes"`
				TXBytes *uint64 `json:"txBytes"`
			} `json:"interfaces"`
		} `json:"network"`
	} `json:"pods"`
}

func NewKubernetesCollector(command, kubeconfig string) *KubernetesCollector {
	if strings.TrimSpace(command) == "" {
		command = "kubectl"
	}
	return &KubernetesCollector{command: command, kubeconfig: kubeconfig}
}

func (c *KubernetesCollector) Available() bool {
	_, err := exec.LookPath(c.command)
	return err == nil
}

func (c *KubernetesCollector) Collect(ctx context.Context) ([]*agentv1.KubernetesPodMetric, error) {
	if !c.Available() {
		return nil, errors.New("Kubernetes client command is unavailable")
	}
	var pods kubernetesPodList
	content, err := c.run(ctx, "get", "pods", "--all-namespaces", "-o", "json")
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(content, &pods); err != nil {
		return nil, fmt.Errorf("decode Kubernetes pod inventory: %w", err)
	}
	usage := c.collectUsage(ctx)
	nodeSet := make(map[string]struct{})
	for _, pod := range pods.Items {
		if pod.Spec.NodeName != "" {
			nodeSet[pod.Spec.NodeName] = struct{}{}
		}
	}
	network := c.collectNetwork(ctx, nodeSet)
	result := make([]*agentv1.KubernetesPodMetric, 0, len(pods.Items))
	for _, pod := range pods.Items {
		metric := &agentv1.KubernetesPodMetric{
			Namespace: pod.Metadata.Namespace, Name: pod.Metadata.Name,
			Node: pod.Spec.NodeName, Phase: pod.Status.Phase,
		}
		ready := 0
		for _, status := range pod.Status.ContainerStatuses {
			if status.Ready {
				ready++
			}
			metric.Restarts += status.RestartCount
		}
		metric.Ready = fmt.Sprintf("%d/%d", ready, len(pod.Spec.Containers))
		for _, container := range pod.Spec.Containers {
			metric.CpuRequestMillicores += parseCPU(container.Resources.Requests["cpu"])
			metric.CpuLimitMillicores += parseCPU(container.Resources.Limits["cpu"])
			metric.MemoryRequestBytes += parseBytes(container.Resources.Requests["memory"])
			metric.MemoryLimitBytes += parseBytes(container.Resources.Limits["memory"])
		}
		if current, exists := usage[pod.Metadata.Namespace+"/"+pod.Metadata.Name]; exists {
			metric.CpuUsageMillicores = current.cpuMillicores
			metric.MemoryUsageBytes = current.memoryBytes
		}
		if current, exists := network[pod.Metadata.Namespace+"/"+pod.Metadata.Name]; exists {
			metric.NetworkReceiveBytesTotal = current.receiveBytes
			metric.NetworkTransmitBytesTotal = current.transmitBytes
		}
		result = append(result, metric)
	}
	return result, nil
}

func (c *KubernetesCollector) collectNetwork(ctx context.Context, nodes map[string]struct{}) map[string]podNetwork {
	result := make(map[string]podNetwork)
	var resultMu sync.Mutex
	semaphore := make(chan struct{}, 4)
	var wait sync.WaitGroup
	for node := range nodes {
		node := node
		wait.Add(1)
		go func() {
			defer wait.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				return
			}
			content, err := c.run(ctx, "get", "--raw", "/api/v1/nodes/"+url.PathEscape(node)+"/proxy/stats/summary")
			if err != nil {
				return
			}
			var summary kubeletSummary
			if err := json.Unmarshal(content, &summary); err != nil {
				return
			}
			resultMu.Lock()
			defer resultMu.Unlock()
			for _, pod := range summary.Pods {
				receive, transmit := dereference(pod.Network.RXBytes), dereference(pod.Network.TXBytes)
				if receive == 0 && transmit == 0 {
					for _, network := range pod.Network.Interfaces {
						receive += dereference(network.RXBytes)
						transmit += dereference(network.TXBytes)
					}
				}
				result[pod.PodRef.Namespace+"/"+pod.PodRef.Name] = podNetwork{receiveBytes: receive, transmitBytes: transmit}
			}
		}()
	}
	wait.Wait()
	return result
}

func dereference(value *uint64) uint64 {
	if value == nil {
		return 0
	}
	return *value
}

func (c *KubernetesCollector) collectUsage(ctx context.Context) map[string]podUsage {
	content, err := c.run(ctx, "get", "--raw", "/apis/metrics.k8s.io/v1beta1/pods")
	if err != nil {
		return nil
	}
	var metrics kubernetesMetricList
	if err := json.Unmarshal(content, &metrics); err != nil {
		return nil
	}
	result := make(map[string]podUsage, len(metrics.Items))
	for _, pod := range metrics.Items {
		current := podUsage{}
		for _, container := range pod.Containers {
			current.cpuMillicores += parseCPU(container.Usage["cpu"])
			current.memoryBytes += parseBytes(container.Usage["memory"])
		}
		result[pod.Metadata.Namespace+"/"+pod.Metadata.Name] = current
	}
	return result
}

func (c *KubernetesCollector) run(ctx context.Context, arguments ...string) ([]byte, error) {
	commandArguments := []string{"--request-timeout=5s"}
	if c.kubeconfig != "" {
		commandArguments = append(commandArguments, "--kubeconfig", c.kubeconfig)
	}
	commandArguments = append(commandArguments, arguments...)
	requestContext, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	command := exec.CommandContext(requestContext, c.command, commandArguments...)
	content, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("Kubernetes inventory command failed")
	}
	if len(content) > 32<<20 {
		return nil, errors.New("Kubernetes inventory exceeds 32 MiB")
	}
	return content, nil
}

func parseCPU(value string) float64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	units := []struct {
		suffix     string
		multiplier float64
	}{{"n", 0.000001}, {"u", 0.001}, {"m", 1}}
	for _, unit := range units {
		if strings.HasSuffix(value, unit.suffix) {
			parsed, _ := strconv.ParseFloat(strings.TrimSuffix(value, unit.suffix), 64)
			return max(parsed*unit.multiplier, 0)
		}
	}
	parsed, _ := strconv.ParseFloat(value, 64)
	return max(parsed*1000, 0)
}

func parseBytes(value string) uint64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	units := []struct {
		suffix     string
		multiplier float64
	}{
		{"Ei", math.Pow(1024, 6)}, {"Pi", math.Pow(1024, 5)}, {"Ti", math.Pow(1024, 4)},
		{"Gi", math.Pow(1024, 3)}, {"Mi", math.Pow(1024, 2)}, {"Ki", 1024},
		{"E", math.Pow(1000, 6)}, {"P", math.Pow(1000, 5)}, {"T", math.Pow(1000, 4)},
		{"G", math.Pow(1000, 3)}, {"M", math.Pow(1000, 2)}, {"K", 1000},
	}
	for _, unit := range units {
		if strings.HasSuffix(value, unit.suffix) {
			parsed, _ := strconv.ParseFloat(strings.TrimSuffix(value, unit.suffix), 64)
			return positiveUint64(parsed * unit.multiplier)
		}
	}
	parsed, _ := strconv.ParseFloat(value, 64)
	return positiveUint64(parsed)
}

func positiveUint64(value float64) uint64 {
	if math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 {
		return 0
	}
	if value >= math.MaxUint64 {
		return math.MaxUint64
	}
	return uint64(value)
}
