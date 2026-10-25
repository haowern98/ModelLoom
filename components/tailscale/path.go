package main

import "time"

// magicsock.populatePeerStatus reports CurAddr/PeerRelay from addrForSendLocked.
// Relay alone is a configured DERP region and cannot prove an observed path.
func observedPath(direct, peerRelay string, lastWrite, now time.Time) (string, int64) {
	if lastWrite.IsZero() || now.Sub(lastWrite) > 15*time.Second || lastWrite.After(now) {
		return "unknown", 0
	}
	if peerRelay != "" {
		return "relayed", lastWrite.UnixMilli()
	}
	if direct != "" {
		return "direct", lastWrite.UnixMilli()
	}
	return "unknown", 0
}
