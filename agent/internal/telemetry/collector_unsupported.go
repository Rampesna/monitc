//go:build !linux

package telemetry

import (
	"context"
	"time"

	agentv1 "github.com/Rampesna/monitc/agent/gen/monitc/agent/v1"
)

type unsupportedCollector struct {
	metadata HostMetadata
}

func NewHostCollector(_ bool) (HostCollector, error) {
	return &unsupportedCollector{metadata: RuntimeMetadata()}, nil
}

func (c *unsupportedCollector) Collect(context.Context, uint64, time.Duration) (*agentv1.SystemMetricSample, error) {
	return nil, ErrUnsupported
}

func (c *unsupportedCollector) Metadata() HostMetadata { return c.metadata }
func (c *unsupportedCollector) EBPFActive() bool       { return false }
func (c *unsupportedCollector) Close() error           { return nil }
