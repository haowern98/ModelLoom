// CPU-only regressions for false and genuine fast/RTO recovery; no host networking.
package tcprecovery

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gvisor.dev/gvisor/pkg/buffer"
	"gvisor.dev/gvisor/pkg/tcpip"
	"gvisor.dev/gvisor/pkg/tcpip/adapters/gonet"
	"gvisor.dev/gvisor/pkg/tcpip/header"
	"gvisor.dev/gvisor/pkg/tcpip/link/channel"
	"gvisor.dev/gvisor/pkg/tcpip/network/ipv4"
	"gvisor.dev/gvisor/pkg/tcpip/stack"
	"gvisor.dev/gvisor/pkg/tcpip/transport/tcp"
)

type connection struct {
	ctx            context.Context
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	a, b           *stack.Stack
	al, bl         *channel.Endpoint
	client, server net.Conn
	listener       net.Listener
	armed          atomic.Bool
	held           chan []byte
	states         chan tcp.TCPSenderState
	mu             sync.Mutex
	latest         tcp.TCPSenderState
}

func tcpHeader(raw []byte) header.TCP { return header.TCP(raw[header.IPv4(raw).HeaderLength():]) }
func payloadLength(raw []byte) int {
	return len(raw) - int(header.IPv4(raw).HeaderLength()) - int(tcpHeader(raw).DataOffset())
}
func inject(link *channel.Endpoint, raw []byte) {
	p := stack.NewPacketBuffer(stack.PacketBufferOptions{Payload: buffer.MakeWithData(append([]byte(nil), raw...))})
	link.InjectInbound(ipv4.ProtocolNumber, p)
	p.DecRef()
}

func newConnection(t *testing.T, cc string, rack, probe bool) *connection {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	c := &connection{ctx: ctx, cancel: cancel, held: make(chan []byte, 256), states: make(chan tcp.TCPSenderState, 4096)}
	makeStack := func(last byte, sender bool) (*stack.Stack, *channel.Endpoint) {
		protocol := tcp.NewProtocol
		if sender && probe {
			protocol = tcp.NewProtocolProbe(func(s *tcp.TCPEndpointState) {
				c.mu.Lock()
				c.latest = s.Sender
				c.mu.Unlock()
				select {
				case c.states <- s.Sender:
				default:
				}
			})
		}
		s := stack.New(stack.Options{NetworkProtocols: []stack.NetworkProtocolFactory{ipv4.NewProtocol}, TransportProtocols: []stack.TransportProtocolFactory{protocol}, ClockResolution: 500 * time.Microsecond})
		link := channel.New(2048, 1240, "")
		if e := s.CreateNIC(1, link); e != nil {
			t.Fatal(e)
		}
		if e := s.AddProtocolAddress(1, tcpip.ProtocolAddress{Protocol: ipv4.ProtocolNumber, AddressWithPrefix: tcpip.AddressWithPrefix{Address: tcpip.AddrFrom4([4]byte{10, 0, 0, last}), PrefixLen: 24}}, stack.AddressProperties{}); e != nil {
			t.Fatal(e)
		}
		s.SetRouteTable([]tcpip.Route{{Destination: header.IPv4EmptySubnet, NIC: 1}})
		sack := tcpip.TCPSACKEnabled(true)
		if e := s.SetTransportProtocolOption(tcp.ProtocolNumber, &sack); e != nil {
			t.Fatal(e)
		}
		recovery := tcpip.TCPRecovery(0)
		if rack {
			recovery = tcpip.TCPRACKLossDetection
		}
		if e := s.SetTransportProtocolOption(tcp.ProtocolNumber, &recovery); e != nil {
			t.Fatal(e)
		}
		opt := tcpip.CongestionControlOption(cc)
		if e := s.SetTransportProtocolOption(tcp.ProtocolNumber, &opt); e != nil {
			t.Fatal(e)
		}
		return s, link
	}
	c.a, c.al = makeStack(1, true)
	c.b, c.bl = makeStack(2, false)
	t.Cleanup(c.close)
	c.wg.Add(2)
	go c.wire(c.al, c.bl, true)

	go c.wire(c.bl, c.al, false)
	l, err := gonet.ListenTCP(c.b, tcpip.FullAddress{NIC: 1, Addr: tcpip.AddrFrom4([4]byte{10, 0, 0, 2}), Port: 8080}, ipv4.ProtocolNumber)
	if err != nil {
		t.Fatal(err)
	}
	c.listener = l
	c.client, err = gonet.DialContextTCP(ctx, c.a, tcpip.FullAddress{NIC: 1, Addr: tcpip.AddrFrom4([4]byte{10, 0, 0, 2}), Port: 8080}, ipv4.ProtocolNumber)
	if err != nil {
		t.Fatal(err)
	}
	c.server, err = l.Accept()
	if err != nil {
		t.Fatal(err)
	}
	d, _ := ctx.Deadline()
	c.client.SetDeadline(d)
	c.server.SetDeadline(d)
	return c
}
func (c *connection) close() {
	c.cancel()
	c.a.Close()
	c.b.Close()
	c.al.Close()
	c.bl.Close()
	c.wg.Wait()
	c.a.Wait()
	c.b.Wait()
}
func (c *connection) wire(from, to *channel.Endpoint, outgoing bool) {
	defer c.wg.Done()
	for {
		pkt := from.ReadContext(c.ctx)
		if pkt == nil {
			return
		}
		v := pkt.ToView()
		raw := append([]byte(nil), v.AsSlice()...)
		v.Release()
		pkt.DecRef()
		if outgoing && c.armed.Load() && payloadLength(raw) > 0 {
			select {
			case c.held <- raw:
			case <-c.ctx.Done():
				return
			}
		} else {
			inject(to, raw)
		}
	}
}
func (c *connection) state() tcp.TCPSenderState { c.mu.Lock(); defer c.mu.Unlock(); return c.latest }
func (c *connection) wait(t *testing.T, what string, predicate func(tcp.TCPSenderState) bool) tcp.TCPSenderState {
	t.Helper()
	for {
		if s := c.state(); predicate(s) {
			return s
		}
		select {
		case s := <-c.states:
			if predicate(s) {
				return s
			}
		case <-c.ctx.Done():
			t.Fatalf("%s timeout; latest=%+v", what, c.state())
			return tcp.TCPSenderState{}
		}
	}
}
func (c *connection) packet(t *testing.T) []byte {
	t.Helper()
	select {
	case p := <-c.held:
		return p
	case <-c.ctx.Done():
		t.Fatal("packet timeout")
		return nil
	}
}
func logResult(t *testing.T, v any) { b, _ := json.Marshal(v); t.Logf("RESULT %s", b) }

func TestRecovery(t *testing.T) {
	if os.Getenv("MODELLOOM_PATCHED_TCP_TEST") != "1" {
		t.Skip("run build-network.mjs for patched dependency tests")
	}
	for _, cc := range []string{"reno", "cubic"} {
		for _, kind := range []string{"fast", "rto"} {
			for _, spurious := range []bool{false, true} {
				name := fmt.Sprintf("%s/%s/spurious=%v", cc, kind, spurious)
				t.Run(name, func(t *testing.T) {
					c := newConnection(t, cc, false, true)
					before := c.state()
					if _, e := c.client.Write([]byte{1}); e != nil {
						t.Fatal(e)
					}
					if _, e := io.ReadFull(c.server, make([]byte, 1)); e != nil {
						t.Fatal(e)
					}
					warm := c.wait(t, "warmup ACK", func(s tcp.TCPSenderState) bool {
						return s.SndUna == s.SndNxt && s.SndNxt != before.SndNxt && s.MaxPayloadSize > 0
					})
					c.armed.Store(true)
					count := 6
					if kind == "rto" {
						count = 2
					}
					data := bytes.Repeat([]byte{42}, count*warm.MaxPayloadSize)
					if _, e := c.client.Write(data); e != nil {
						t.Fatal(e)
					}
					original := make([][]byte, count)
					for i := range original {
						original[i] = c.packet(t)
					}
					first := tcpHeader(original[0]).SequenceNumber()
					time.Sleep(10 * time.Millisecond)
					if kind == "fast" {
						for i := 1; i < count-1; i++ {
							inject(c.bl, original[i])
						}
					}
					var retransmit []byte
					for {
						p := c.packet(t)
						if tcpHeader(p).SequenceNumber() == first {
							retransmit = p
							break
						}
					}
					if spurious {
						inject(c.bl, original[0])
					} else {
						inject(c.bl, retransmit)
					}
					partial := first + uint32((count-1)*warm.MaxPayloadSize)
					c.wait(t, "partial recovery ACK", func(s tcp.TCPSenderState) bool { return uint32(s.SndUna) == partial })
					inject(c.bl, original[count-1])
					end := c.wait(t, "recovery exit ACK", func(s tcp.TCPSenderState) bool {
						return uint32(s.SndUna) == first+uint32(len(data)) && !s.FastRecovery.Active
					})
					got := make([]byte, len(data))
					if _, e := io.ReadFull(c.server, got); e != nil {
						t.Fatal(e)
					}
					if !bytes.Equal(data, got) {
						t.Fatal("delivered bytes changed")
					}
					detected := c.a.Stats().TCP.SpuriousRecovery.Value() > 0
					if detected != spurious {
						t.Fatalf("spurious detection=%v want=%v; before=%+v end=%+v", detected, spurious, warm, end)
					}
					restored := end.Ssthresh >= warm.SndCwnd
					wantRestore := spurious
					if restored != wantRestore {
						t.Fatalf("restored=%v want=%v; before cwnd=%d after ssthresh=%d cwnd=%d", restored, wantRestore, warm.SndCwnd, end.Ssthresh, end.SndCwnd)
					}
					if wantRestore && end.SndCwnd > tcp.InitialCwnd+end.Outstanding {
						t.Fatal("recovery response allowed an excessive burst")
					}
					if kind == "rto" && c.a.Stats().TCP.Timeouts.Value() == 0 {
						t.Fatal("RTO case did not experience a timeout")
					}
					logResult(t, map[string]any{"case": name, "beforeCwnd": warm.SndCwnd, "afterCwnd": end.SndCwnd, "afterSsthresh": end.Ssthresh, "spurious": detected, "restored": restored, "payloadSHA256": fmt.Sprintf("%x", sha256.Sum256(got))})
				})
			}
		}
	}
}
