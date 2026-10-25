package main

import (
	"testing"
	"time"
)

func TestObservedPathNeverInfersConfiguredDERP(t *testing.T) {
	now := time.Now()
	for _, test := range []struct {
		direct, relay string
		sent          time.Time
		want          string
	}{
		{"1.2.3.4:10", "", now, "direct"}, {"", "1.2.3.4:10:vni:1", now, "relayed"},
		{"", "", now, "unknown"}, {"1.2.3.4:10", "", now.Add(-time.Minute), "unknown"},
		{"1.2.3.4:10", "", time.Time{}, "unknown"},
	} {
		path, at := observedPath(test.direct, test.relay, test.sent, now)
		if path != test.want || (path == "unknown" && at != 0) {
			t.Fatalf("path %s at %d, want %s", path, at, test.want)
		}
	}
}
