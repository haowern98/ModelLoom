package main

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func vaultTestRoot(t *testing.T) string {
	t.Helper()
	// Match the canonical root supplied by the desktop, even through temporary-directory aliases.
	temporary := t.TempDir()
	root, err := filepath.EvalSymlinks(temporary)
	if err != nil {
		t.Fatalf("resolve vault test root %q: %v", temporary, err)
	}
	return root
}

func TestVaultAtomicCiphertextRoundtrip(t *testing.T) {
	v := &cipherVault{root: vaultTestRoot(t)}
	if value, err := v.apply(frame{Action: "read"}); err != nil || value.Found {
		t.Fatal("unexpected initial state", err)
	}
	payload := bytes.Repeat([]byte{0xa1, 0x11}, chunkSize)
	if _, err := v.apply(frame{Action: "begin"}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := v.apply(frame{Action: "append", Seq: uint64(i + 1), Data: base64.StdEncoding.EncodeToString(payload[i*chunkSize : (i+1)*chunkSize])}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := os.Stat(filepath.Join(v.root, "enrollment.bin")); !os.IsNotExist(err) {
		t.Fatal("uncommitted state reached disk")
	}
	if _, err := v.apply(frame{Action: "commit"}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		value, err := v.apply(frame{Action: "read", Seq: uint64(i)})
		if err != nil || !value.Found {
			t.Fatal(err)
		}
		data, err := base64.StdEncoding.DecodeString(value.Data)
		if err != nil {
			t.Fatal(err)
		}
		if i < 2 && !bytes.Equal(data, payload[i*chunkSize:(i+1)*chunkSize]) {
			t.Fatal("ciphertext changed")
		}
		if i == 2 && len(data) != 0 {
			t.Fatal("expected EOF")
		}
	}
	if _, err := v.apply(frame{Action: "commit"}); err == nil {
		t.Fatal("commit without begin")
	}
}

func TestVaultRejectsOutOfOrderAndOversizedCiphertext(t *testing.T) {
	v := &cipherVault{root: vaultTestRoot(t)}
	if _, err := v.apply(frame{Action: "append", Seq: 1, Data: "eA=="}); err == nil {
		t.Fatal("append without begin")
	}
	v.apply(frame{Action: "begin"})
	if _, err := v.apply(frame{Action: "append", Seq: 2, Data: "eA=="}); err == nil {
		t.Fatal("out of order accepted")
	}
	v.apply(frame{Action: "begin"})
	encoded := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, chunkSize))
	for i := 1; i <= vaultMaximum/chunkSize; i++ {
		if _, err := v.apply(frame{Action: "append", Seq: uint64(i), Data: encoded}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := v.apply(frame{Action: "append", Seq: uint64(vaultMaximum/chunkSize + 1), Data: encoded}); err == nil {
		t.Fatal("oversized ciphertext accepted")
	}
	v.reset()
	if _, err := v.apply(frame{Action: "commit"}); err == nil {
		t.Fatal("reset retained transaction")
	}
}

func TestVaultRejectsLinkedEnrollment(t *testing.T) {
	root := vaultTestRoot(t)
	other := filepath.Join(t.TempDir(), "other.bin")
	os.WriteFile(other, []byte("untouched"), 0600)
	if err := os.Symlink(other, filepath.Join(root, "enrollment.bin")); err != nil {
		t.Skipf("symlink privilege unavailable: %v", err)
	}
	v := &cipherVault{root: root}
	if _, err := v.apply(frame{Action: "read"}); err == nil {
		t.Fatal("linked ciphertext accepted")
	}
	v.apply(frame{Action: "begin"})
	v.apply(frame{Action: "append", Seq: 1, Data: "eA=="})
	if _, err := v.apply(frame{Action: "commit"}); err == nil {
		t.Fatal("linked target replaced")
	}
	data, _ := os.ReadFile(other)
	if string(data) != "untouched" {
		t.Fatal("external target modified")
	}
}

func TestVaultProtocolBounds(t *testing.T) {
	for _, raw := range []string{
		`{"type":"vault","id":1,"action":"read","seq":257}`,
		`{"type":"vault","id":1,"action":"begin","data":"eA=="}`,
		`{"type":"vault","id":1,"action":"append","seq":1,"data":"!"}`,
		`{"type":"vault","id":1,"action":"commit","path":"other"}`,
	} {
		if _, err := decodeFrame([]byte(raw)); err == nil {
			t.Fatal("accepted malformed vault request", raw)
		}
	}
	for _, raw := range []string{`{"type":"vault","id":1,"action":"read"}`, `{"type":"vault","id":2,"action":"append","seq":1,"data":"eA=="}`} {
		if _, err := decodeFrame([]byte(raw)); err != nil {
			t.Fatal(err)
		}
	}
}
