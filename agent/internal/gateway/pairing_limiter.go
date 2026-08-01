package gateway

import (
	"context"
	"net"
	"sync"
	"time"

	"google.golang.org/grpc/peer"
)

const (
	pairingWindow = time.Minute
	pairingBurst  = 10
)

type pairingWindowState struct {
	startedAt time.Time
	requests  int
}

type pairingRateLimiter struct {
	mu      sync.Mutex
	windows map[string]pairingWindowState
}

func newPairingRateLimiter() *pairingRateLimiter {
	return &pairingRateLimiter{windows: make(map[string]pairingWindowState)}
}

func (l *pairingRateLimiter) Allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if key == "" {
		key = "unknown"
	}
	state := l.windows[key]
	if state.startedAt.IsZero() || now.Sub(state.startedAt) >= pairingWindow {
		l.windows[key] = pairingWindowState{startedAt: now, requests: 1}
		l.prune(now)
		return true
	}
	if state.requests >= pairingBurst {
		return false
	}
	state.requests++
	l.windows[key] = state
	return true
}

func (l *pairingRateLimiter) prune(now time.Time) {
	if len(l.windows) < 1024 {
		return
	}
	for key, state := range l.windows {
		if now.Sub(state.startedAt) >= pairingWindow {
			delete(l.windows, key)
		}
	}
}

func pairingPeerKey(ctx context.Context) string {
	grpcPeer, ok := peer.FromContext(ctx)
	if !ok || grpcPeer.Addr == nil {
		return "unknown"
	}
	host, _, err := net.SplitHostPort(grpcPeer.Addr.String())
	if err == nil && host != "" {
		return host
	}
	return grpcPeer.Addr.String()
}
