package agent

import (
	"os"
	"testing"

	agentv1 "github.com/Rampesna/monitc/agent/gen/monitc/agent/v1"
	"google.golang.org/protobuf/proto"
)

func TestSpoolPersistsEvictsAndAcknowledgesBatches(t *testing.T) {
	t.Parallel()
	bootID := "aa111111-bbbb-4ccc-8ddd-eeeeeeeeeeee"
	first := testBatch(bootID, 1)
	encoded, err := proto.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	spool, err := NewSpool(t.TempDir(), uint64(len(encoded)*2-1))
	if err != nil {
		t.Fatal(err)
	}
	if err := spool.Put(first); err != nil {
		t.Fatal(err)
	}
	if err := spool.Put(testBatch(bootID, 2)); err != nil {
		t.Fatal(err)
	}
	items, err := spool.Items()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].FirstSequence != 2 {
		t.Fatalf("expected only sequence 2 after bounded eviction, got %#v", items)
	}
	highest, err := spool.HighestSequence(bootID)
	if err != nil || highest != 2 {
		t.Fatalf("expected highest spooled sequence 2, got %d (error: %v)", highest, err)
	}
	stored, err := spool.Read(items[0])
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(stored, testBatch(bootID, 2)) {
		t.Fatal("spooled protobuf changed after round trip")
	}
	if err := spool.Acknowledge(bootID, 2); err != nil {
		t.Fatal(err)
	}
	_, batches, err := spool.Stats()
	if err != nil {
		t.Fatal(err)
	}
	if batches != 0 {
		t.Fatalf("expected an empty spool after acknowledgement, got %d batches", batches)
	}
}

func TestSpoolQuarantinesRejectedBatchOutsideSendQueue(t *testing.T) {
	t.Parallel()
	spool, err := NewSpool(t.TempDir(), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	bootID := "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
	if err := spool.Put(testBatch(bootID, 1)); err != nil {
		t.Fatal(err)
	}
	items, err := spool.Items()
	if err != nil || len(items) != 1 {
		t.Fatalf("expected one queued batch, got %d (error: %v)", len(items), err)
	}
	quarantined, err := spool.Quarantine(items[0])
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(quarantined); err != nil {
		t.Fatalf("quarantined batch is missing: %v", err)
	}
	items, err = spool.Items()
	if err != nil || len(items) != 0 {
		t.Fatalf("rejected batch remained in the send queue: %v", err)
	}
}

func TestSpoolAcknowledgesTheInFlightItemWithoutRescanning(t *testing.T) {
	t.Parallel()
	spool, err := NewSpool(t.TempDir(), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	bootID := "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
	for sequence := uint64(1); sequence <= 3; sequence++ {
		if err := spool.Put(testBatch(bootID, sequence)); err != nil {
			t.Fatal(err)
		}
	}
	oldest, available := spool.Oldest()
	if !available || oldest.FirstSequence != 1 {
		t.Fatalf("expected sequence 1 at the head of the spool, got %#v", oldest)
	}
	if err := spool.AcknowledgeItem(oldest); err != nil {
		t.Fatal(err)
	}
	next, available := spool.Oldest()
	if !available || next.FirstSequence != 2 {
		t.Fatalf("expected sequence 2 after exact acknowledgement, got %#v", next)
	}
	_, batches, err := spool.Stats()
	if err != nil || batches != 2 {
		t.Fatalf("expected two queued batches, got %d (error: %v)", batches, err)
	}
}

func testBatch(bootID string, sequence uint64) *agentv1.MetricBatch {
	return &agentv1.MetricBatch{
		AgentId: "agent-test",
		BootId:  bootID,
		Samples: []*agentv1.SystemMetricSample{{Sequence: sequence, CpuPercent: float64(sequence)}},
	}
}
