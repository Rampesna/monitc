package gateway

import (
	"testing"
	"time"
)

func TestPairingRateLimiterBoundsAndResetsWindows(t *testing.T) {
	t.Parallel()
	limiter := newPairingRateLimiter()
	now := time.Unix(1_700_000_000, 0)
	for attempt := 0; attempt < pairingBurst; attempt++ {
		if !limiter.Allow("192.0.2.1", now) {
			t.Fatalf("attempt %d should be allowed", attempt+1)
		}
	}
	if limiter.Allow("192.0.2.1", now) {
		t.Fatal("attempt beyond the burst should be rejected")
	}
	if !limiter.Allow("192.0.2.1", now.Add(pairingWindow)) {
		t.Fatal("a new window should allow pairing again")
	}
	if !limiter.Allow("192.0.2.2", now) {
		t.Fatal("rate limits must be isolated per peer")
	}
}
