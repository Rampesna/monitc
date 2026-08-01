package agent

import "testing"

func TestIdentityPersistsProducedAndAcknowledgedSequencesSeparately(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	identity, err := LoadOrCreateIdentity(directory)
	if err != nil {
		t.Fatal(err)
	}
	bootID := "aa111111-bbbb-4ccc-8ddd-eeeeeeeeeeee"
	if sequence := identity.NextSequence(bootID); sequence != 1 {
		t.Fatalf("expected sequence 1, got %d", sequence)
	}
	if sequence := identity.NextSequence(bootID); sequence != 2 {
		t.Fatalf("expected sequence 2, got %d", sequence)
	}
	if err := identity.PersistSequence(); err != nil {
		t.Fatal(err)
	}
	if err := identity.Acknowledge(bootID, 1); err != nil {
		t.Fatal(err)
	}
	reloaded, err := LoadOrCreateIdentity(directory)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := reloaded.Snapshot()
	if snapshot.LastSequence != 2 || snapshot.AcknowledgedSequence != 1 || snapshot.AcknowledgedBootID != bootID {
		t.Fatalf(
			"unexpected persisted identity state: last=%d acknowledged=%d acknowledgedBoot=%q",
			snapshot.LastSequence,
			snapshot.AcknowledgedSequence,
			snapshot.AcknowledgedBootID,
		)
	}
}

func TestIdentityReconcilesSequenceFromDurableSpool(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	identity, err := LoadOrCreateIdentity(directory)
	if err != nil {
		t.Fatal(err)
	}
	bootID := "aa111111-bbbb-4ccc-8ddd-eeeeeeeeeeee"
	if err := identity.EnsureSequenceAtLeast(bootID, 42); err != nil {
		t.Fatal(err)
	}
	if sequence := identity.NextSequence(bootID); sequence != 43 {
		t.Fatalf("expected reconciled sequence 43, got %d", sequence)
	}
}
