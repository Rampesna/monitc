package agent

import (
	"context"
	"time"

	agentv1 "github.com/Rampesna/monitc/agent/gen/monitc/agent/v1"
)

func (r *Runtime) runCollector(ctx context.Context) {
	sampleInterval, batchInterval := r.settings.intervals()
	sampleTimer := time.NewTimer(sampleInterval)
	batchTimer := time.NewTimer(batchInterval)
	defer sampleTimer.Stop()
	defer batchTimer.Stop()
	metadata := r.host.Metadata()
	batch := &agentv1.MetricBatch{AgentId: r.identity.Snapshot().AgentID, BootId: metadata.BootID}

	for {
		select {
		case <-ctx.Done():
			r.flushBatch(batch)
			return
		case <-sampleTimer.C:
			sampleInterval, _ = r.settings.intervals()
			sequence := r.identity.NextSequence(metadata.BootID)
			sample, err := r.host.Collect(ctx, sequence, sampleInterval)
			if err != nil {
				r.logger.Warn("host telemetry collection failed", "error", err)
			} else {
				batch.Samples = append(batch.Samples, sample)
			}
			sampleTimer.Reset(sampleInterval)
		case <-batchTimer.C:
			r.flushBatch(batch)
			batch = &agentv1.MetricBatch{AgentId: r.identity.Snapshot().AgentID, BootId: metadata.BootID}
			_, batchInterval = r.settings.intervals()
			batchTimer.Reset(batchInterval)
		}
	}
}

func (r *Runtime) flushBatch(batch *agentv1.MetricBatch) {
	if batch == nil || len(batch.GetSamples()) == 0 {
		return
	}
	pods, containers, sampledAt := r.inventory.take()
	batch.Pods = pods
	batch.Containers = containers
	if !sampledAt.IsZero() {
		batch.InventorySampledAtUnixNanos = sampledAt.UnixNano()
	}
	if err := r.spool.Put(batch); err != nil {
		r.logger.Error("metric batch could not be added to the offline spool", "error", err)
		return
	}
	if err := r.identity.PersistSequence(); err != nil {
		r.logger.Error("metric sequence could not be persisted", "error", err)
	}
}

func (r *Runtime) runInventoryCollector(ctx context.Context) {
	collect := func() {
		var pods []*agentv1.KubernetesPodMetric
		var containers []*agentv1.DockerContainerMetric
		if r.docker != nil && r.settings.enabled(agentv1.Capability_CAPABILITY_DOCKER_READ) {
			inventoryContext, cancel := context.WithTimeout(ctx, 12*time.Second)
			collected, err := r.docker.Collect(inventoryContext)
			cancel()
			if err != nil {
				r.logger.Debug("Docker inventory unavailable", "error", err)
			} else {
				containers = collected
			}
		}
		if r.kubernetes != nil && r.settings.enabled(agentv1.Capability_CAPABILITY_KUBERNETES_READ) {
			inventoryContext, cancel := context.WithTimeout(ctx, 15*time.Second)
			collected, err := r.kubernetes.Collect(inventoryContext)
			cancel()
			if err != nil {
				r.logger.Debug("Kubernetes inventory unavailable", "error", err)
			} else {
				pods = collected
			}
		}
		r.inventory.update(pods, containers, time.Now().UTC())
	}
	collect()
	ticker := time.NewTicker(r.config.Telemetry.InventoryInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			collect()
		}
	}
}
