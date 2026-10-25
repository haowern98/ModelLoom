package main

import (
	"encoding/json"
	"runtime"
	"testing"
	"time"
)

type storeFrames chan frame

func (frames storeFrames) Write(bytes []byte) (int, error) {
	var value frame
	if err := json.Unmarshal(bytes, &value); err != nil {
		return 0, err
	}
	frames <- value
	return len(bytes), nil
}

func TestStoreIDsAreAllocatedInOutputOrder(t *testing.T) {
	frames := make(storeFrames, 2)
	out := &output{writer: frames}
	store := &stateStore{out: out, pending: make(map[uint64]chan frame)}
	results := make(chan error, 2)
	out.mu.Lock()
	go func() { _, err := store.call("store-read", "first", nil); results <- err }()
	deadline := time.Now().Add(time.Second)
	for store.next.Load() != 1 && time.Now().Before(deadline) {
		runtime.Gosched()
	}
	if store.next.Load() != 1 {
		out.mu.Unlock()
		t.Fatal("first request did not reach blocked output")
	}
	started := make(chan struct{})
	go func() { close(started); _, err := store.call("store-read", "second", nil); results <- err }()
	<-started
	// The second caller can run, but it cannot allocate an ID before the first emits.
	deadline = time.Now().Add(100 * time.Millisecond)
	for store.next.Load() == 1 && time.Now().Before(deadline) {
		runtime.Gosched()
	}
	allocated := store.next.Load()
	out.mu.Unlock()
	for expected := uint64(1); expected <= 2; expected++ {
		select {
		case value := <-frames:
			store.reply(frame{Type: "store-result", ID: value.ID})
			if value.ID != expected {
				t.Errorf("wire ID %d, expected %d", value.ID, expected)
			}
		case <-time.After(time.Second):
			t.Fatal("request did not emit")
		}
	}
	for i := 0; i < 2; i++ {
		select {
		case err := <-results:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(time.Second):
			t.Fatal("response blocked")
		}
	}
	if allocated != 1 {
		t.Fatalf("allocated %d request IDs while first frame was blocked", allocated)
	}
}
