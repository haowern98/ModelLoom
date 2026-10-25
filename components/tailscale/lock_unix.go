//go:build linux || darwin

package main

import (
	"golang.org/x/sys/unix"
	"os"
)

func privateRoot(root string) error { return os.Chmod(root, 0700) }

func lockOwner(name string) (*os.File, error) {
	file, err := os.OpenFile(name, os.O_CREATE|os.O_RDWR|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	if err = unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		file.Close()
		return nil, err
	}
	return file, nil
}
