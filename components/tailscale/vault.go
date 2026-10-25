package main

import (
	"encoding/base64"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
)

const vaultMaximum = 8 * 1024 * 1024

// The process holding owner.lock performs all ciphertext IO. Paths are fixed.
type cipherVault struct {
	mu       sync.Mutex
	root     string
	pending  []byte
	sequence uint64
	active   bool
}

func (v *cipherVault) clearLocked() {
	clear(v.pending)
	v.pending = nil
	v.sequence = 0
	v.active = false
}
func (v *cipherVault) reset() { v.mu.Lock(); defer v.mu.Unlock(); v.clearLocked() }
func (v *cipherVault) location() (string, error) {
	root, err := filepath.Abs(v.root)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil || resolved != root {
		return "", errors.New("unsafe vault root")
	}
	stat, err := os.Lstat(root)
	if err != nil || !stat.IsDir() || stat.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("unsafe vault root")
	}
	file := filepath.Join(root, "enrollment.bin")
	stat, err = os.Lstat(file)
	if err != nil {
		if os.IsNotExist(err) {
			return file, nil
		}
		return "", err
	}
	if !stat.Mode().IsRegular() || stat.Mode()&os.ModeSymlink != 0 || stat.Size() > vaultMaximum {
		return "", errors.New("unsafe vault file")
	}
	return file, nil
}
func (v *cipherVault) apply(value frame) (frame, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	result := frame{Type: "vault-result", ID: value.ID, Seq: value.Seq}
	fail := func() (frame, error) { return result, errors.New("NETWORK_STORAGE_UNAVAILABLE") }
	file, err := v.location()
	if err != nil {
		return fail()
	}
	switch value.Action {
	case "read":
		if value.Seq > vaultMaximum/chunkSize {
			return fail()
		}
		input, err := os.Open(file)
		if os.IsNotExist(err) {
			return result, nil
		}
		if err != nil {
			return fail()
		}
		defer input.Close()
		stat, err := input.Stat()
		if err != nil || !stat.Mode().IsRegular() || stat.Size() > vaultMaximum {
			return fail()
		}
		data := make([]byte, chunkSize)
		n, err := input.ReadAt(data, int64(value.Seq)*chunkSize)
		if err != nil && err != io.EOF {
			return fail()
		}
		result.Found = true
		result.Data = base64.StdEncoding.EncodeToString(data[:n])
		return result, nil
	case "begin":
		v.clearLocked()
		v.active = true
		return result, nil
	case "append":
		data, err := base64.StdEncoding.Strict().DecodeString(value.Data)
		if err != nil || len(data) == 0 || len(data) > chunkSize || !v.active || value.Seq != v.sequence+1 || len(v.pending)+len(data) > vaultMaximum {
			v.clearLocked()
			return fail()
		}
		v.pending = append(v.pending, data...)
		v.sequence = value.Seq
		return result, nil
	case "commit":
		if !v.active || len(v.pending) == 0 {
			return fail()
		}
		defer v.clearLocked()
		output, err := os.CreateTemp(v.root, ".enrollment-*.new")
		if err != nil {
			return fail()
		}
		temporary := output.Name()
		defer os.Remove(temporary)
		if err = output.Chmod(0600); err == nil {
			_, err = output.Write(v.pending)
		}
		if err == nil {
			err = output.Sync()
		}
		closeErr := output.Close()
		if err != nil || closeErr != nil {
			return fail()
		}
		if _, err = v.location(); err != nil {
			return fail()
		}
		if err = os.Rename(temporary, file); err != nil {
			return fail()
		}
		return result, nil
	}
	return fail()
}
