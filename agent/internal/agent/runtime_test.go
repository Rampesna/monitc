package agent

import (
	"errors"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestPermanentMetricBatchRejectionIsNarrowlyMatched(t *testing.T) {
	t.Parallel()
	if !isPermanentMetricBatchRejection(status.Error(codes.InvalidArgument, "metric batch failed validation")) {
		t.Fatal("the gateway's permanent batch rejection should be recognized")
	}
	for _, candidate := range []error{
		status.Error(codes.InvalidArgument, "heartbeat failed validation"),
		status.Error(codes.Unavailable, "metric batch failed validation"),
		errors.New("metric batch failed validation"),
	} {
		if isPermanentMetricBatchRejection(candidate) {
			t.Fatalf("unrelated stream error was treated as a permanent batch rejection: %v", candidate)
		}
	}
}
