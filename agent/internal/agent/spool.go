package agent

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	agentv1 "github.com/Rampesna/monitc/agent/gen/monitc/agent/v1"
	"google.golang.org/protobuf/proto"
)

var spoolNamePattern = regexp.MustCompile(`^([a-fA-F0-9-]{1,64})_([0-9]{20})_([0-9]{20})\.pb$`)

const maximumQuarantinedBatches = 16

type Spool struct {
	mu           sync.Mutex
	directory    string
	maximumBytes uint64
	items        []SpoolItem
	usedBytes    uint64
}

type SpoolItem struct {
	Path          string
	BootID        string
	FirstSequence uint64
	LastSequence  uint64
	Size          uint64
	ModifiedAt    time.Time
}

func NewSpool(stateDirectory string, maximumBytes uint64) (*Spool, error) {
	directory := filepath.Join(stateDirectory, "spool")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create metric spool: %w", err)
	}
	items, err := loadSpoolItems(directory)
	if err != nil {
		return nil, fmt.Errorf("index metric spool: %w", err)
	}
	spool := &Spool{directory: directory, maximumBytes: maximumBytes, items: items}
	for _, item := range items {
		spool.usedBytes += item.Size
	}
	return spool, nil
}

func (s *Spool) Put(batch *agentv1.MetricBatch) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if batch == nil || len(batch.GetSamples()) == 0 {
		return errors.New("metric spool batch requires at least one sample")
	}
	bootID := sanitizeBootID(batch.GetBootId())
	if bootID == "" {
		return errors.New("metric spool batch requires a valid boot ID")
	}
	first, last := batch.GetSamples()[0].GetSequence(), batch.GetSamples()[0].GetSequence()
	for _, sample := range batch.GetSamples()[1:] {
		first = min(first, sample.GetSequence())
		last = max(last, sample.GetSequence())
	}
	content, err := proto.MarshalOptions{Deterministic: true}.Marshal(batch)
	if err != nil {
		return fmt.Errorf("encode metric spool batch: %w", err)
	}
	if uint64(len(content)) > s.maximumBytes {
		return errors.New("single metric batch exceeds the spool capacity")
	}
	if err := s.makeRoom(uint64(len(content))); err != nil {
		return err
	}
	name := fmt.Sprintf("%s_%020d_%020d.pb", bootID, first, last)
	itemPath := filepath.Join(s.directory, name)
	if err := atomicWrite(itemPath, content, 0o600); err != nil {
		return err
	}
	info, err := os.Stat(itemPath)
	if err != nil {
		return fmt.Errorf("index metric spool batch: %w", err)
	}
	item := SpoolItem{
		Path: itemPath, BootID: bootID, FirstSequence: first, LastSequence: last,
		Size: uint64(max(info.Size(), 0)), ModifiedAt: info.ModTime(),
	}
	s.items = append(s.items, item)
	s.usedBytes += item.Size
	if len(s.items) > 1 && spoolItemLess(item, s.items[len(s.items)-2]) {
		sort.Slice(s.items, func(left, right int) bool { return spoolItemLess(s.items[left], s.items[right]) })
	}
	return nil
}

func (s *Spool) Items() ([]SpoolItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]SpoolItem(nil), s.items...), nil
}

func (s *Spool) Oldest() (SpoolItem, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.items) == 0 {
		return SpoolItem{}, false
	}
	return s.items[0], true
}

func (s *Spool) Read(item SpoolItem) (*agentv1.MetricBatch, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if filepath.Dir(item.Path) != s.directory {
		return nil, errors.New("invalid metric spool path")
	}
	content, err := os.ReadFile(item.Path)
	if err != nil {
		return nil, err
	}
	batch := new(agentv1.MetricBatch)
	if err := proto.Unmarshal(content, batch); err != nil {
		return nil, fmt.Errorf("decode metric spool batch: %w", err)
	}
	return batch, nil
}

func (s *Spool) Acknowledge(bootID string, throughSequence uint64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	bootID = sanitizeBootID(bootID)
	remaining := s.items[:0]
	for _, item := range s.items {
		if item.BootID == bootID && item.LastSequence <= throughSequence {
			if err := os.Remove(item.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			s.usedBytes = subtractBytes(s.usedBytes, item.Size)
			continue
		}
		remaining = append(remaining, item)
	}
	s.items = remaining
	return nil
}

// AcknowledgeItem is the hot-path acknowledgement for the single in-flight
// batch. It avoids rescanning and sorting the full offline queue for every ACK.
func (s *Spool) AcknowledgeItem(item SpoolItem) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.validItemPath(item.Path) {
		return errors.New("invalid metric spool path")
	}
	if err := os.Remove(item.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for index, queued := range s.items {
		if queued.Path != item.Path {
			continue
		}
		s.usedBytes = subtractBytes(s.usedBytes, queued.Size)
		if index == 0 {
			s.items = s.items[1:]
		} else {
			s.items = append(s.items[:index], s.items[index+1:]...)
		}
		break
	}
	return nil
}

// Quarantine removes a permanently rejected batch from the send queue while
// retaining a bounded diagnostic copy. This prevents one malformed batch from
// blocking every newer sample indefinitely.
func (s *Spool) Quarantine(item SpoolItem) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.validItemPath(item.Path) {
		return "", errors.New("invalid metric spool path")
	}
	quarantineDirectory := filepath.Join(s.directory, "rejected")
	if err := os.MkdirAll(quarantineDirectory, 0o700); err != nil {
		return "", fmt.Errorf("create rejected metric directory: %w", err)
	}
	target := filepath.Join(quarantineDirectory, filepath.Base(item.Path))
	if err := os.Rename(item.Path, target); err != nil {
		return "", fmt.Errorf("quarantine rejected metric batch: %w", err)
	}
	s.removeIndexedItem(item.Path)
	entries, err := os.ReadDir(quarantineDirectory)
	if err != nil {
		return target, nil
	}
	type rejectedItem struct {
		path       string
		modifiedAt time.Time
	}
	rejected := make([]rejectedItem, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr == nil {
			rejected = append(rejected, rejectedItem{path: filepath.Join(quarantineDirectory, entry.Name()), modifiedAt: info.ModTime()})
		}
	}
	sort.Slice(rejected, func(left, right int) bool { return rejected[left].modifiedAt.Before(rejected[right].modifiedAt) })
	for len(rejected) > maximumQuarantinedBatches {
		_ = os.Remove(rejected[0].path)
		rejected = rejected[1:]
	}
	return target, nil
}

func (s *Spool) Stats() (uint64, uint32, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.usedBytes, uint32(min(len(s.items), int(^uint32(0)))), nil
}

func (s *Spool) HighestSequence(bootID string) (uint64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	bootID = sanitizeBootID(bootID)
	if bootID == "" {
		return 0, errors.New("boot ID is invalid")
	}
	var highest uint64
	for _, item := range s.items {
		if item.BootID == bootID {
			highest = max(highest, item.LastSequence)
		}
	}
	return highest, nil
}

func (s *Spool) makeRoom(required uint64) error {
	for s.usedBytes+required > s.maximumBytes && len(s.items) > 0 {
		oldest := s.items[0]
		if err := os.Remove(oldest.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("evict oldest metric spool batch: %w", err)
		}
		s.usedBytes = subtractBytes(s.usedBytes, oldest.Size)
		s.items = s.items[1:]
	}
	if s.usedBytes+required > s.maximumBytes {
		return errors.New("metric spool capacity could not be recovered")
	}
	return nil
}

func loadSpoolItems(directory string) ([]SpoolItem, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, err
	}
	items := make([]SpoolItem, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		matches := spoolNamePattern.FindStringSubmatch(entry.Name())
		if matches == nil {
			continue
		}
		first, firstErr := strconv.ParseUint(matches[2], 10, 64)
		last, lastErr := strconv.ParseUint(matches[3], 10, 64)
		info, infoErr := entry.Info()
		if firstErr != nil || lastErr != nil || infoErr != nil {
			continue
		}
		items = append(items, SpoolItem{
			Path:   filepath.Join(directory, entry.Name()),
			BootID: matches[1], FirstSequence: first, LastSequence: last, Size: uint64(max(info.Size(), 0)),
			ModifiedAt: info.ModTime(),
		})
	}
	sort.Slice(items, func(left, right int) bool { return spoolItemLess(items[left], items[right]) })
	return items, nil
}

func (s *Spool) validItemPath(itemPath string) bool {
	return filepath.Dir(itemPath) == s.directory &&
		spoolNamePattern.FindStringSubmatch(filepath.Base(itemPath)) != nil
}

func (s *Spool) removeIndexedItem(itemPath string) {
	for index, item := range s.items {
		if item.Path != itemPath {
			continue
		}
		s.usedBytes = subtractBytes(s.usedBytes, item.Size)
		if index == 0 {
			s.items = s.items[1:]
		} else {
			s.items = append(s.items[:index], s.items[index+1:]...)
		}
		return
	}
}

func spoolItemLess(left, right SpoolItem) bool {
	if left.ModifiedAt.Equal(right.ModifiedAt) {
		return left.Path < right.Path
	}
	return left.ModifiedAt.Before(right.ModifiedAt)
}

func subtractBytes(total, value uint64) uint64 {
	if total < value {
		return 0
	}
	return total - value
}

func sanitizeBootID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 64 {
		return ""
	}
	for _, character := range value {
		if (character < 'a' || character > 'f') && (character < 'A' || character > 'F') &&
			(character < '0' || character > '9') && character != '-' {
			return ""
		}
	}
	return value
}
