package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestLargePeerSnapshotsUseBoundedOrderedFrames(t *testing.T) {
	var buffer bytes.Buffer
	out := output{writer: &buffer}
	peers := make([]peer, 2000)
	for i := range peers {
		peers[i] = peer{ID: "peer", Address: "100.90.40.12", Name: strings.Repeat("n", 80), Online: true}
	}
	if err := out.send(frame{Type: "status", State: "connected", Peers: peers}); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(buffer.String()), "\n")
	if len(lines) < 3 {
		t.Fatal("snapshot not paged")
	}
	count := 0
	for _, line := range lines {
		if len(line) > maxFrame {
			t.Fatal("oversized frame")
		}
		var f frame
		if err := json.Unmarshal([]byte(line), &f); err != nil {
			t.Fatal(err)
		}
		count += len(f.Peers)
	}
	if count != len(peers) {
		t.Fatal("peers lost")
	}
}

func TestFramesRejectUnknownFieldsAndOversizedPayloads(t *testing.T) {
	for _, raw := range []string{`{"type":"command","id":1,"action":"connect","evil":true}`, `{"type":"data","stream":"h-1","seq":1,"data":"!"}`, strings.Repeat("x", maxFrame+1)} {
		if _, err := decodeFrame([]byte(raw)); err == nil {
			t.Fatal("accepted malformed frame")
		}
	}
	if _, err := decodeFrame([]byte(`{"type":"command","id":1,"action":"connect"}`)); err != nil {
		t.Fatal(err)
	}
}

func TestDialTargetsAreVisiblePeersAndOnlyFixedApplicationPorts(t *testing.T) {
	if validTarget("100.90.40.12", 443, map[string]bool{"100.90.40.12": true}) {
		t.Fatal("arbitrary port")
	}
	if validTarget("1.1.1.1", 49301, map[string]bool{}) {
		t.Fatal("unknown peer")
	}
	if !validTarget("100.90.40.12", 49301, map[string]bool{"100.90.40.12": true}) {
		t.Fatal("visible peer rejected")
	}
}

func TestPerTypeFieldsAndDuplicateKeysAreRejected(t *testing.T) {
	for _, raw := range []string{`{"type":"command","id":1,"action":"connect","data":"secret"}`, `{"type":"command","id":1,"id":2,"action":"connect"}`} {
		if _, err := decodeFrame([]byte(raw)); err == nil {
			t.Fatal("accepted mixed or duplicate fields")
		}
	}
}

func TestOwnershipLockIsExclusiveAndReleasedOnClose(t *testing.T) {
	file := t.TempDir() + "/owner.lock"
	first, err := lockOwner(file)
	if err != nil {
		t.Fatal(err)
	}
	if second, err := lockOwner(file); err == nil {
		second.Close()
		t.Fatal("second owner admitted")
	}
	first.Close()
	next, err := lockOwner(file)
	if err != nil {
		t.Fatal(err)
	}
	next.Close()
}
