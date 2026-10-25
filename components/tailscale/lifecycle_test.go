package main

import (
	"context"
	"net"
	"strings"
	"testing"
	"time"

	"tailscale.com/tsnet"
)

type lifecycleOutput struct{ data chan struct{} }

func (o lifecycleOutput) Write(bytes []byte) (int, error) {
	if strings.Contains(string(bytes), `"type":"data"`) {
		select {
		case o.data <- struct{}{}:
		default:
		}
	}
	return len(bytes), nil
}

func lifecycleComponent() *component {
	return &component{ctx: context.Background(), out: &output{writer: lifecycleOutput{data: make(chan struct{}, 1)}}, server: &tsnet.Server{}, streams: make(map[string]*stream), peers: map[string]bool{"100.100.100.1": true}}
}

func TestCloseBeforeDialAttachmentCancelsPending(t *testing.T) {
	c := lifecycleComponent()
	p := c.registerDial(frame{Stream: "h-1", Address: "100.100.100.1", Port: 49301})
	if p == nil {
		t.Fatal("dial was not registered")
	}
	defer p.cancel()
	if !c.receive(frame{Type: "close", Stream: "h-1"}) {
		t.Fatal("close rejected")
	}
	if p.ctx.Err() == nil {
		t.Fatal("pending dial was not cancelled")
	}
	local, remote := net.Pipe()
	defer local.Close()
	defer remote.Close()
	if c.attachDial("h-1", local, p) {
		t.Fatal("closed pending dial attached")
	}
	if len(c.pending) != 0 || len(c.streams) != 0 {
		t.Fatal("closed dial retained")
	}
}

func TestOldGenerationCannotAttachDialOrIncoming(t *testing.T) {
	c := lifecycleComponent()
	p := c.registerDial(frame{Stream: "h-1", Address: "100.100.100.1", Port: 49301})
	if p == nil {
		t.Fatal("dial was not registered")
	}
	defer p.cancel()
	oldServer, oldGeneration := c.server, c.generation
	c.mu.Lock()
	c.generation++
	c.server = &tsnet.Server{}
	c.mu.Unlock()
	local, remote := net.Pipe()
	defer local.Close()
	defer remote.Close()
	if c.attachDial("h-1", local, p) {
		t.Fatal("old generation dial attached")
	}
	if c.attachInbound("g-1", local, oldServer, oldGeneration) {
		t.Fatal("old listener attached")
	}
}

func TestStopCancelsPendingAndClosesStreamDone(t *testing.T) {
	c := lifecycleComponent()
	p := c.registerDial(frame{Stream: "h-1", Address: "100.100.100.1", Port: 49301})
	if p == nil {
		t.Fatal("dial was not registered")
	}
	local, remote := net.Pipe()
	defer remote.Close()
	if !c.attach("g-1", local) {
		t.Fatal("attach failed")
	}
	s := c.streams["g-1"]
	oldGeneration := c.generation
	c.stop()
	if p.ctx.Err() == nil || c.server != nil || c.generation == oldGeneration {
		t.Fatal("stop retained node admission")
	}
	select {
	case <-s.done:
	default:
		t.Fatal("stop did not close stream notification")
	}
	s.close() // Repeated cleanup is safe.
	if len(c.streams) != 0 || len(c.pending) != 0 {
		t.Fatal("stop retained streams")
	}
}

func TestCloseWakesWriterWaitingForFrame(t *testing.T) {
	c := lifecycleComponent()
	local, remote := net.Pipe()
	defer remote.Close()
	s := &stream{conn: local, done: make(chan struct{}), write: make(chan frame, 1), ack: make(chan uint64, 1)}
	done := make(chan struct{})
	go func() { c.write("g-1", s); close(done) }()
	s.close()
	select {
	case <-done:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("closed stream writer did not exit")
	}
}

func TestSignOutQuiescesAdmissionBeforeLogout(t *testing.T) {
	c := lifecycleComponent()
	previous := c.server
	p := c.registerDial(frame{Stream: "h-1", Address: "100.100.100.1", Port: 49301})
	if p == nil {
		t.Fatal("dial not registered")
	}
	defer p.cancel()
	if c.quiesce() != previous {
		t.Fatal("quiesce did not retain logout target")
	}
	if c.server != nil {
		t.Fatal("sign-out cleanup still admits dials while logout waits")
	}
	if p.ctx.Err() == nil {
		t.Fatal("pending dial retained")
	}
	if c.registerDial(frame{Stream: "h-2", Address: "100.100.100.1", Port: 49301}) != nil {
		t.Fatal("dial admitted during logout")
	}
	local, remote := net.Pipe()
	defer local.Close()
	defer remote.Close()
	if c.attachInbound("g-1", local, previous, p.generation) {
		t.Fatal("old listener admitted during logout")
	}
}

func TestOnlyRetiredOwnedStreamsTolerateLateFrames(t *testing.T) {
	c := lifecycleComponent()
	local, remote := net.Pipe()
	defer remote.Close()
	if !c.attach("g-1", local) {
		t.Fatal("attach failed")
	}
	c.closeStream("g-1")
	if !c.receive(frame{Type: "data", Stream: "g-1", Seq: 1, Data: "eA=="}) {
		t.Fatal("late owned data rejected")
	}
	if c.receive(frame{Type: "data", Stream: "g-2", Seq: 1, Data: "eA=="}) {
		t.Fatal("future stream accepted")
	}
	if c.receive(frame{Type: "ack", Stream: "h-999", Seq: 1}) {
		t.Fatal("unknown stream accepted")
	}
	if c.receive(frame{Type: "close", Stream: "h-999"}) {
		t.Fatal("future close accepted")
	}
}

func TestFailedDialRetiresBeforeParentClose(t *testing.T) {
	c := lifecycleComponent()
	p := c.registerDial(frame{Stream: "h-1", Address: "100.100.100.1", Port: 49301})
	if p == nil {
		t.Fatal("dial not registered")
	}
	defer p.cancel()
	c.rejectDial(frame{ID: 1, Stream: "h-1"})
	if p.ctx.Err() == nil || len(c.pending) != 0 {
		t.Fatal("failed dial retained pending ownership")
	}
	if !c.receive(frame{Type: "close", Stream: "h-1"}) {
		t.Fatal("parent cleanup of failed dial rejected")
	}
	if c.receive(frame{Type: "close", Stream: "h-2"}) {
		t.Fatal("future stream cleanup accepted")
	}
}

func TestCloseWakesPumpWaitingForAcknowledgement(t *testing.T) {
	sink := lifecycleOutput{data: make(chan struct{}, 1)}
	c := &component{ctx: context.Background(), out: &output{writer: sink}, streams: make(map[string]*stream)}
	local, remote := net.Pipe()
	defer remote.Close()
	if !c.attach("h-1", local) {
		t.Fatal("attach failed")
	}
	done := make(chan struct{})
	go func() { c.pump("h-1"); close(done) }()
	go remote.Write([]byte("test"))
	select {
	case <-sink.data:
	case <-time.After(time.Second):
		t.Fatal("pump did not send data")
	}
	c.closeStream("h-1")
	select {
	case <-done:
	case <-time.After(100 * time.Millisecond):
		t.Fatal("closed stream still waiting for acknowledgement")
	}
}
