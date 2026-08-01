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

type Spool struct {
	mu           sync.Mutex
	directory    string
	maximumBytes uint64
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
	return &Spool{directory: directory, maximumBytes: maximumBytes}, nil
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
	return atomicWrite(filepath.Join(s.directory, name), content, 0o600)
}

func (s *Spool) Items() ([]SpoolItem, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.itemsLocked()
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
	items, err := s.itemsLocked()
	if err != nil {
		return err
	}
	for _, item := range items {
		if item.BootID == sanitizeBootID(bootID) && item.LastSequence <= throughSequence {
			if err := os.Remove(item.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
		}
	}
	return nil
}

func (s *Spool) Stats() (uint64, uint32, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items, err := s.itemsLocked()
	if err != nil {
		return 0, 0, err
	}
	var bytes uint64
	for _, item := range items {
		bytes += item.Size
	}
	return bytes, uint32(min(len(items), int(^uint32(0)))), nil
}

func (s *Spool) HighestSequence(bootID string) (uint64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	bootID = sanitizeBootID(bootID)
	if bootID == "" {
		return 0, errors.New("boot ID is invalid")
	}
	items, err := s.itemsLocked()
	if err != nil {
		return 0, err
	}
	var highest uint64
	for _, item := range items {
		if item.BootID == bootID {
			highest = max(highest, item.LastSequence)
		}
	}
	return highest, nil
}

func (s *Spool) makeRoom(required uint64) error {
	items, err := s.itemsLocked()
	if err != nil {
		return err
	}
	var used uint64
	for _, item := range items {
		used += item.Size
	}
	for used+required > s.maximumBytes && len(items) > 0 {
		oldest := items[0]
		if err := os.Remove(oldest.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("evict oldest metric spool batch: %w", err)
		}
		if used >= oldest.Size {
			used -= oldest.Size
		} else {
			used = 0
		}
		items = items[1:]
	}
	if used+required > s.maximumBytes {
		return errors.New("metric spool capacity could not be recovered")
	}
	return nil
}

func (s *Spool) itemsLocked() ([]SpoolItem, error) {
	entries, err := os.ReadDir(s.directory)
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
			Path:   filepath.Join(s.directory, entry.Name()),
			BootID: matches[1], FirstSequence: first, LastSequence: last, Size: uint64(max(info.Size(), 0)),
			ModifiedAt: info.ModTime(),
		})
	}
	sort.Slice(items, func(left, right int) bool {
		if items[left].ModifiedAt.Equal(items[right].ModifiedAt) {
			return items[left].Path < items[right].Path
		}
		return items[left].ModifiedAt.Before(items[right].ModifiedAt)
	})
	return items, nil
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
