package main

import (
	"encoding/base64"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"tailscale.com/ipn"
)

// State is protected by the owning desktop's OS store; no plaintext FileStore exists.
type stateStore struct {
	out     *output
	next    atomic.Uint64
	emit    sync.Mutex
	mu      sync.Mutex
	pending map[uint64]chan frame
}

func (s *stateStore) call(action, key string, data []byte) (frame, error) {
	// IDs must follow wire order even when several tsnet goroutines persist state.
	s.emit.Lock()
	id := s.next.Add(1)
	result := make(chan frame, 1)
	s.mu.Lock()
	s.pending[id] = result
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.pending, id); s.mu.Unlock() }()
	if err := s.out.send(frame{Type: action, ID: id, Key: key, Data: base64.StdEncoding.EncodeToString(data), Found: data != nil}); err != nil {
		s.emit.Unlock()
		return frame{}, err
	}
	s.emit.Unlock()
	select {
	case value := <-result:
		if value.Error != "" {
			return value, errors.New("NETWORK_STORAGE_UNAVAILABLE")
		}
		return value, nil
	case <-time.After(15 * time.Second):
		return frame{}, errors.New("NETWORK_STORAGE_UNAVAILABLE")
	}
}
func (s *stateStore) reply(value frame) {
	s.mu.Lock()
	pending := s.pending[value.ID]
	s.mu.Unlock()
	if pending != nil {
		select {
		case pending <- value:
		default:
		}
	}
}
func (s *stateStore) ReadState(key ipn.StateKey) ([]byte, error) {
	value, err := s.call("store-read", string(key), nil)
	if err != nil {
		return nil, err
	}
	if !value.Found {
		return nil, ipn.ErrStateNotExist
	}
	return base64.StdEncoding.Strict().DecodeString(value.Data)
}
func (s *stateStore) WriteState(key ipn.StateKey, data []byte) error {
	_, err := s.call("store-write", string(key), data)
	return err
}
func (*stateStore) String() string { return "ModelLoom OS-protected enrollment" }
