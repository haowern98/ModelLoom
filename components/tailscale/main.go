// ModelLoom's private networking component. No host daemon or public management socket.
package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"tailscale.com/ipn"
	"tailscale.com/tsnet"
)

type stream struct {
	conn     net.Conn
	done     chan struct{}
	closed   sync.Once
	ack      chan uint64
	write    chan frame
	received uint64
}

func (s *stream) close() { s.closed.Do(func() { close(s.done); _ = s.conn.Close() }) }

type pendingDial struct {
	ctx        context.Context
	cancel     context.CancelFunc
	server     *tsnet.Server
	generation uint64
}
type component struct {
	out          *output
	store        *stateStore
	mu           sync.Mutex
	server       *tsnet.Server
	generation   uint64
	pending      map[string]*pendingDial
	retired      map[string]bool
	retiredOrder []string
	cancel       context.CancelFunc
	streams      map[string]*stream
	peers        map[string]bool
	listeners    []net.Listener
	next         atomic.Uint64
	control      sync.Mutex
	commandID    uint64
	ctx          context.Context
	root         string
	vault        *cipherVault
}

func main() {
	// Never inherit credentials, routes, control servers or debug behavior from the shell.
	for _, value := range os.Environ() {
		name := strings.SplitN(value, "=", 2)[0]
		if strings.HasPrefix(name, "TS_") || strings.HasPrefix(name, "TAILSCALE_") {
			_ = os.Unsetenv(name)
		}
	}
	_ = os.Setenv("TS_NO_LOGS_NO_SUPPORT", "true")
	if len(os.Args) != 2 {
		os.Exit(2)
	}
	root := os.Args[1]
	info, err := os.Lstat(root)
	resolved, resolveErr := filepath.EvalSymlinks(root)
	if err != nil || resolveErr != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || resolved != root || privateRoot(root) != nil {
		os.Exit(3)
	}
	lease, err := lockOwner(filepath.Join(root, "owner.lock"))
	if err != nil {
		os.Exit(3)
	}
	defer lease.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	out := &output{writer: os.Stdout}
	store := &stateStore{out: out, pending: make(map[uint64]chan frame)}
	c := &component{out: out, store: store, streams: make(map[string]*stream), peers: make(map[string]bool), ctx: ctx, root: root, vault: &cipherVault{root: root}}
	commands := make(chan frame, 16)
	vaultCommands := make(chan frame, 16)
	var vaultWorker sync.WaitGroup
	vaultWorker.Add(1)
	defer func() { cancel(); vaultWorker.Wait(); c.vault.reset() }()
	go func() {
		defer vaultWorker.Done()
		for {
			select {
			case <-ctx.Done():
				return
			case value := <-vaultCommands:
				if ctx.Err() != nil {
					return
				}
				result, err := c.vault.apply(value)
				if err != nil {
					result = frame{Type: "vault-result", ID: value.ID, Seq: value.Seq, Error: "NETWORK_STORAGE_UNAVAILABLE"}
				}
				_ = out.send(result)
			}
		}
	}()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case value := <-commands:
				err := c.command(value.Action)
				code := ""
				if err != nil {
					code = "NETWORK_UNAVAILABLE"
				}
				_ = out.send(frame{Type: "result", ID: value.ID, Error: code})
			}
		}
	}()
	_ = out.send(frame{Type: "ready"})
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), maxFrame+1)
	for scanner.Scan() {
		value, err := decodeFrame(scanner.Bytes())
		if err != nil {
			break
		}
		switch value.Type {
		case "store-result":
			store.reply(value)
		case "command", "dial", "vault":
			if value.ID <= c.commandID {
				cancel()
				c.stop()
				return
			}
			c.commandID = value.ID
			if value.Type == "vault" {
				select {
				case vaultCommands <- value:
				default:
					cancel()
					c.stop()
					return
				}
			} else if value.Type == "dial" {
				pending := c.registerDial(value)
				if pending == nil {
					_ = out.send(frame{Type: "result", ID: value.ID, Error: "NETWORK_ROUTE_UNAVAILABLE"})
				} else {
					go c.dial(value, pending)
				}
			} else {
				select {
				case commands <- value:
				default:
					cancel()
					c.stop()
					return
				}
			}
		case "data", "ack", "close":
			if !c.receive(value) {
				cancel()
				c.stop()
				return
			}
		}
	}
	cancel()
	c.stop() // stdin EOF also tears down the node after an abnormal parent exit.
}
func (c *component) command(action string) error {
	switch action {
	case "connect":
		return c.start()
	case "disconnect":
		c.stop()
		return c.out.send(frame{Type: "status", State: "disconnected"})
	case "sign-out":
		srv := c.quiesce()
		if srv == nil {
			return errors.New("not connected")
		}
		defer srv.Close()
		lc, err := srv.LocalClient()
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(c.ctx, 10*time.Second)
		defer cancel()
		if err = lc.Logout(ctx); err != nil {
			return err
		}
		return c.out.send(frame{Type: "status", State: "disconnected"})
	case "listen":
		return c.listen()
	case "unlisten":
		c.unlisten()
		return nil
	case "status":
		return c.status()
	case "quit":
		c.stop()
		os.Exit(0)
	}
	return errors.New("bad action")
}
func (c *component) start() error {
	c.mu.Lock()
	if c.server != nil {
		c.mu.Unlock()
		return c.status()
	}
	ctx, cancel := context.WithCancel(c.ctx)
	host, _ := os.Hostname()
	srv := &tsnet.Server{Dir: c.root, Store: c.store, Hostname: "modelloom-" + host, UserLogf: func(string, ...any) {}, Logf: func(string, ...any) {}}
	c.server = srv
	c.cancel = cancel
	c.mu.Unlock()
	_ = c.out.send(frame{Type: "status", State: "starting"})
	if err := srv.Start(); err != nil {
		c.stop()
		return err
	}
	lc, err := srv.LocalClient()
	if err != nil {
		c.stop()
		return err
	}
	watcher, err := lc.WatchIPNBus(ctx, ipn.NotifyInitialState)
	if err != nil {
		c.stop()
		return err
	}
	go func() {
		defer watcher.Close()
		for {
			n, err := watcher.Next()
			if err != nil {
				return
			}
			if n.BrowseToURL != nil && *n.BrowseToURL != "" {
				_ = c.out.send(frame{Type: "login", URL: *n.BrowseToURL})
			}
			_ = c.status()
		}
	}()
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = c.status()
			}
		}
	}()
	return nil
}
func (c *component) status() error {
	c.mu.Lock()
	srv := c.server
	c.mu.Unlock()
	if srv == nil {
		return c.out.send(frame{Type: "status", State: "disconnected"})
	}
	lc, err := srv.LocalClient()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(c.ctx, 3*time.Second)
	defer cancel()
	st, err := lc.Status(ctx)
	if err != nil {
		return err
	}
	state := "reconnecting"
	switch st.BackendState {
	case "Running":
		state = "connected"
	case "NeedsLogin":
		state = "needs-login"
	case "NeedsMachineAuth":
		state = "needs-approval"
	case "Starting":
		state = "starting"
	case "Stopped":
		state = "disconnected"
	}
	if st.Self != nil && st.Self.Expired {
		state = "expired"
	}
	result := frame{Type: "status", State: state, Addresses: []string{}, Peers: []peer{}}
	known := make(map[string]bool)
	for _, ip := range st.TailscaleIPs {
		result.Addresses = append(result.Addresses, ip.String())
	}
	if st.CurrentTailnet != nil {
		result.Tailnet = st.CurrentTailnet.Name
	}
	if st.Self != nil {
		if user, ok := st.User[st.Self.UserID]; ok {
			result.Account = user.LoginName
		}
	}
	for _, p := range st.Peer {
		path, observedAt := observedPath(p.CurAddr, p.PeerRelay, p.LastWrite, time.Now())
		for _, ip := range p.TailscaleIPs {
			if !ip.Is4() {
				continue
			}
			known[ip.String()] = true
			result.Peers = append(result.Peers, peer{ID: string(p.ID), Address: ip.String(), Name: p.HostName, Online: p.Online, Path: path, ObservedAt: observedAt})
		}
	}
	c.mu.Lock()
	if c.server != srv {
		c.mu.Unlock()
		return nil
	}
	c.peers = known
	c.mu.Unlock()
	return c.out.send(result)
}
func (c *component) listen() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.server == nil {
		return errors.New("not connected")
	}
	if len(c.listeners) > 0 {
		return nil
	}
	srv, generation := c.server, c.generation
	for _, port := range []int{49301, 49302} {
		listener, err := c.server.Listen("tcp", fmt.Sprintf(":%d", port))
		if err != nil {
			for _, l := range c.listeners {
				_ = l.Close()
			}
			c.listeners = nil
			return err
		}
		c.listeners = append(c.listeners, listener)
		go func() {
			for {
				conn, err := listener.Accept()
				if err != nil {
					return
				}
				id := fmt.Sprintf("g-%d", c.next.Add(1))
				if !c.attachInbound(id, conn, srv, generation) {
					_ = conn.Close()
					continue
				}
				_ = c.out.send(frame{Type: "incoming", Stream: id, Port: port})
				go c.pump(id)
			}
		}()
	}
	return nil
}
func (c *component) unlisten() {
	c.mu.Lock()
	listeners := c.listeners
	c.listeners = nil
	c.mu.Unlock()
	for _, l := range listeners {
		_ = l.Close()
	}
}

// Detach admission before logout or shutdown can block on external work.
func (c *component) quiesce() *tsnet.Server {
	c.mu.Lock()
	srv := c.server
	c.server = nil
	c.generation++
	listeners, streams, pending := c.listeners, c.streams, c.pending
	for id := range streams {
		c.retireLocked(id)
	}
	for id := range pending {
		c.retireLocked(id)
	}
	c.listeners = nil
	c.streams = make(map[string]*stream)
	c.pending = make(map[string]*pendingDial)
	if c.cancel != nil {
		c.cancel()
		c.cancel = nil
	}
	c.peers = make(map[string]bool)
	c.mu.Unlock()
	for _, p := range pending {
		p.cancel()
	}
	for _, listener := range listeners {
		_ = listener.Close()
	}
	for _, s := range streams {
		s.close()
	}
	return srv
}
func (c *component) stop() {
	srv := c.quiesce()
	if srv != nil {
		_ = srv.Close()
	}
}
func (c *component) attach(id string, conn net.Conn) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.attachLocked(id, conn)
}
func (c *component) attachInbound(id string, conn net.Conn, srv *tsnet.Server, generation uint64) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.server == srv && c.generation == generation && c.server != nil && c.attachLocked(id, conn)
}

// attachLocked is called only after the route's node ownership is validated under mu.
func (c *component) attachLocked(id string, conn net.Conn) bool {
	if len(c.streams)+len(c.pending) >= 64 || c.streams[id] != nil {
		return false
	}
	s := &stream{conn: conn, done: make(chan struct{}), ack: make(chan uint64, 1), write: make(chan frame, 1)}
	c.streams[id] = s
	go c.write(id, s)
	return true
}

// Register before dispatching the goroutine so an immediately following close can cancel it.
func (c *component) registerDial(value frame) *pendingDial {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.server == nil || !validTarget(value.Address, value.Port, c.peers) || len(c.pending)+len(c.streams) >= 64 || c.pending[value.Stream] != nil || c.streams[value.Stream] != nil {
		// The parent already owns this requested stream and may close it after rejection.
		c.retireLocked(value.Stream)
		return nil
	}
	ctx, cancel := context.WithTimeout(c.ctx, 10*time.Second)
	p := &pendingDial{ctx: ctx, cancel: cancel, server: c.server, generation: c.generation}
	if c.pending == nil {
		c.pending = make(map[string]*pendingDial)
	}
	c.pending[value.Stream] = p
	return p
}
func (c *component) attachDial(id string, conn net.Conn, p *pendingDial) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.pending[id] != p || p.ctx.Err() != nil || c.server != p.server || c.generation != p.generation {
		return false
	}
	delete(c.pending, id)
	return c.attachLocked(id, conn)
}
func (c *component) dial(value frame, p *pendingDial) {
	defer p.cancel()
	defer func() {
		c.mu.Lock()
		if c.pending[value.Stream] == p {
			delete(c.pending, value.Stream)
		}
		c.mu.Unlock()
	}()
	conn, err := p.server.Dial(p.ctx, "tcp", net.JoinHostPort(value.Address, fmt.Sprint(value.Port)))
	if err != nil || !c.attachDial(value.Stream, conn, p) {
		if conn != nil {
			_ = conn.Close()
		}
		c.rejectDial(value)
		return
	}
	_ = c.out.send(frame{Type: "result", ID: value.ID})
	c.pump(value.Stream)
}
func (c *component) rejectDial(value frame) {
	// Retire before the result: the parent immediately closes its failed pipe.
	c.closeStream(value.Stream)
	_ = c.out.send(frame{Type: "result", ID: value.ID, Error: "NETWORK_ROUTE_UNAVAILABLE"})
}
func (c *component) closeStream(id string) {
	c.mu.Lock()
	s := c.streams[id]
	delete(c.streams, id)
	p := c.pending[id]
	delete(c.pending, id)
	if s != nil || p != nil {
		c.retireLocked(id)
	}
	c.mu.Unlock()
	if p != nil {
		p.cancel()
	}
	if s != nil {
		s.close()
		_ = c.out.send(frame{Type: "close", Stream: id})
	}
}

// Only recently owned IDs tolerate in-flight frames after cancellation; never future IDs.
func (c *component) retireLocked(id string) {
	if c.retired == nil {
		c.retired = make(map[string]bool)
	}
	if c.retired[id] {
		return
	}
	c.retired[id] = true
	c.retiredOrder = append(c.retiredOrder, id)
	if len(c.retiredOrder) > 256 {
		delete(c.retired, c.retiredOrder[0])
		c.retiredOrder = c.retiredOrder[1:]
	}
}
func (c *component) pump(id string) {
	c.mu.Lock()
	s := c.streams[id]
	c.mu.Unlock()
	if s == nil {
		return
	}
	defer c.closeStream(id)
	buffer := make([]byte, chunkSize)
	var seq uint64
	for {
		n, err := s.conn.Read(buffer)
		if n > 0 {
			seq++
			if c.out.send(frame{Type: "data", Stream: id, Seq: seq, Data: base64.StdEncoding.EncodeToString(buffer[:n])}) != nil {
				return
			}
			select {
			case ack := <-s.ack:
				if ack != seq {
					return
				}
			case <-time.After(60 * time.Second):
				return
			case <-c.ctx.Done():
				return
			case <-s.done:
				return
			}
		}
		if err != nil {
			return
		}
	}
}
func (c *component) write(id string, s *stream) {
	for {
		select {
		case value := <-s.write:
			data, err := base64.StdEncoding.Strict().DecodeString(value.Data)
			if err != nil {
				return
			}
			_ = s.conn.SetWriteDeadline(time.Now().Add(60 * time.Second))
			if _, err = io.CopyN(s.conn, strings.NewReader(string(data)), int64(len(data))); err != nil {
				c.closeStream(id)
				return
			}
			_ = c.out.send(frame{Type: "ack", Stream: id, Seq: value.Seq})
		case <-c.ctx.Done():
			return
		case <-s.done:
			return
		case <-time.After(60 * time.Second):
			c.mu.Lock()
			active := c.streams[id] == s
			c.mu.Unlock()
			if !active {
				return
			}
		}
	}
}
func (c *component) receive(value frame) bool {
	if value.Type == "close" {
		c.mu.Lock()
		known := c.streams[value.Stream] != nil || c.pending[value.Stream] != nil || c.retired[value.Stream]
		c.mu.Unlock()
		if !known {
			return false
		}
		c.closeStream(value.Stream)
		return true
	}
	c.mu.Lock()
	s := c.streams[value.Stream]
	retired := c.retired[value.Stream]
	c.mu.Unlock()
	if s == nil {
		return retired
	}
	switch value.Type {
	case "close":
		c.closeStream(value.Stream)
		return true
	case "ack":
		select {
		case s.ack <- value.Seq:
			return true
		default:
			return false
		}
	case "data":
		if value.Seq != s.received+1 {
			return false
		}
		s.received = value.Seq
		select {
		case s.write <- value:
			return true
		default:
			return false
		}
	}
	return false
}
