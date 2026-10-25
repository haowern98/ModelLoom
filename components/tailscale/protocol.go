package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
)

const maxFrame = 131072
const chunkSize = 32768

type frame struct {
	Type      string   `json:"type"`
	ID        uint64   `json:"id,omitempty"`
	Action    string   `json:"action,omitempty"`
	Key       string   `json:"key,omitempty"`
	Data      string   `json:"data,omitempty"`
	Found     bool     `json:"found,omitempty"`
	Error     string   `json:"error,omitempty"`
	Stream    string   `json:"stream,omitempty"`
	Seq       uint64   `json:"seq,omitempty"`
	Address   string   `json:"address,omitempty"`
	Port      int      `json:"port,omitempty"`
	URL       string   `json:"url,omitempty"`
	State     string   `json:"state,omitempty"`
	Account   string   `json:"account,omitempty"`
	Tailnet   string   `json:"tailnet,omitempty"`
	Addresses []string `json:"addresses,omitempty"`
	Peers     []peer   `json:"peers,omitempty"`
}
type peer struct {
	ID         string `json:"id"`
	Address    string `json:"address"`
	Name       string `json:"name"`
	Online     bool   `json:"online"`
	Path       string `json:"path,omitempty"`
	ObservedAt int64  `json:"observedAt,omitempty"`
}

func decodeFrame(raw []byte) (frame, error) {
	var value frame
	if len(raw) > maxFrame {
		return value, errors.New("frame too large")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return value, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return value, err
	}
	allowed := map[string]string{"vault": "type,id,action,seq,data", "command": "type,id,action", "dial": "type,id,stream,address,port", "store-result": "type,id,data,found,error", "data": "type,stream,seq,data", "ack": "type,stream,seq", "close": "type,stream"}[value.Type]
	if allowed == "" {
		return value, errors.New("bad type")
	}
	for field := range fields {
		if !strings.Contains(","+allowed+",", ","+field+",") {
			return value, errors.New("mixed frame fields")
		}
	}
	// Count keys with the streaming decoder: map decoding alone accepts duplicates.
	check := json.NewDecoder(bytes.NewReader(raw))
	if _, err := check.Token(); err != nil {
		return value, err
	}
	seen := map[string]bool{}
	for check.More() {
		token, err := check.Token()
		if err != nil {
			return value, err
		}
		key, ok := token.(string)
		if !ok || seen[key] {
			return value, errors.New("duplicate key")
		}
		seen[key] = true
		var ignored json.RawMessage
		if err = check.Decode(&ignored); err != nil {
			return value, err
		}
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return value, errors.New("trailing frame")
	}
	switch value.Type {
	case "vault":
		if value.ID == 0 {
			return value, errors.New("bad vault id")
		}
		switch value.Action {
		case "read":
			if value.Seq > vaultMaximum/chunkSize || value.Data != "" {
				return value, errors.New("bad vault read")
			}
		case "begin", "commit":
			if value.Seq != 0 || value.Data != "" {
				return value, errors.New("bad vault operation")
			}
		case "append":
			data, err := base64.StdEncoding.Strict().DecodeString(value.Data)
			if err != nil || len(data) == 0 || len(data) > chunkSize || value.Seq == 0 || base64.StdEncoding.EncodeToString(data) != value.Data {
				return value, errors.New("bad vault append")
			}
		default:
			return value, errors.New("bad vault action")
		}
	case "command":
		if value.ID == 0 || (value.Action != "connect" && value.Action != "disconnect" && value.Action != "sign-out" && value.Action != "status" && value.Action != "listen" && value.Action != "unlisten" && value.Action != "quit") {
			return value, errors.New("bad action")
		}
	case "dial":
		if value.ID == 0 || value.Stream != fmt.Sprintf("h-%d", value.ID) {
			return value, errors.New("bad dial")
		}
	case "store-result":
		if value.ID == 0 {
			return value, errors.New("bad store")
		}
	case "data":
		data, err := base64.StdEncoding.Strict().DecodeString(value.Data)
		if err != nil || len(data) == 0 || len(data) > chunkSize || value.Stream == "" || value.Seq == 0 {
			return value, errors.New("bad data")
		}
	case "ack", "close":
		if value.Stream == "" {
			return value, errors.New("bad stream")
		}
	default:
		return value, errors.New("bad type")
	}
	return value, nil
}
func validTarget(address string, port int, peers map[string]bool) bool {
	return (port == 49301 || port == 49302) && peers[address]
}

type output struct {
	mu     sync.Mutex
	writer io.Writer
	batch  uint64
}

func (o *output) send(value frame) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if value.Type == "status" && len(value.Peers) > 256 {
		o.batch++
		if err := o.write(frame{Type: "peer-batch", ID: o.batch, Action: "begin"}); err != nil {
			return err
		}
		for offset := 0; offset < len(value.Peers); offset += 256 {
			end := offset + 256
			if end > len(value.Peers) {
				end = len(value.Peers)
			}
			if err := o.write(frame{Type: "peer-batch", ID: o.batch, Action: "append", Peers: value.Peers[offset:end]}); err != nil {
				return err
			}
		}
		value.ID = o.batch
		value.Peers = nil
	}
	return o.write(value)
}
func (o *output) write(value frame) error {
	bytes, err := json.Marshal(value)
	if err != nil || len(bytes) > maxFrame {
		return errors.New("invalid output")
	}
	_, err = o.writer.Write(append(bytes, '\n'))
	return err
}
