// CPU-only regression for gvisor.dev/issue/14092. No host networking or GPU use.
package tcpreorder

import (
	"bytes"
	"context"
	"io"
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

func TestSACKAccounting(t *testing.T) {
	if os.Getenv("MODELLOOM_PATCHED_TCP_TEST") != "1" {
		t.Skip("run build-network.mjs: it tests the patched dependency copy")
	}
	testReordering(t)
}

func testReordering(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	states := make(chan tcp.TCPSenderState, 256)
	probe := func(s *tcp.TCPEndpointState) {
		select {
		case states <- s.Sender:
		default:
		}
	}
	makeStack := func(last byte, sender bool) (*stack.Stack, *channel.Endpoint) {
		protocol := tcp.NewProtocol
		if sender {
			protocol = tcp.NewProtocolProbe(probe)
		}
		s := stack.New(stack.Options{NetworkProtocols: []stack.NetworkProtocolFactory{ipv4.NewProtocol}, TransportProtocols: []stack.TransportProtocolFactory{protocol}})
		t.Cleanup(func() { s.Close(); s.Wait() })
		link := channel.New(256, 1240, "")
		t.Cleanup(link.Close)
		if err := s.CreateNIC(1, link); err != nil {
			t.Fatal(err)
		}
		addr := tcpip.AddrFrom4([4]byte{10, 0, 0, last})
		if err := s.AddProtocolAddress(1, tcpip.ProtocolAddress{Protocol: ipv4.ProtocolNumber, AddressWithPrefix: tcpip.AddressWithPrefix{Address: addr, PrefixLen: 24}}, stack.AddressProperties{}); err != nil {
			t.Fatal(err)
		}
		s.SetRouteTable([]tcpip.Route{{Destination: header.IPv4EmptySubnet, NIC: 1}})
		sack := tcpip.TCPSACKEnabled(true)
		if err := s.SetTransportProtocolOption(tcp.ProtocolNumber, &sack); err != nil {
			t.Fatal(err)
		}
		recovery := tcpip.TCPRecovery(0)
		if err := s.SetTransportProtocolOption(tcp.ProtocolNumber, &recovery); err != nil {
			t.Fatal(err)
		}
		cc := tcpip.CongestionControlOption("cubic")
		if err := s.SetTransportProtocolOption(tcp.ProtocolNumber, &cc); err != nil {
			t.Fatal(err)
		}
		return s, link
	}
	a, al := makeStack(1, true)
	b, bl := makeStack(2, false)
	inject := func(link *channel.Endpoint, raw []byte) {
		p := stack.NewPacketBuffer(stack.PacketBufferOptions{Payload: buffer.MakeWithData(append([]byte(nil), raw...))})
		link.InjectInbound(ipv4.ProtocolNumber, p)
		p.DecRef()
	}
	tcpHeader := func(raw []byte) header.TCP { return header.TCP(raw[header.IPv4(raw).HeaderLength():]) }
	var armed atomic.Bool
	packets := make(chan []byte, 16)
	acks := make(chan uint32, 16)
	var wg sync.WaitGroup
	bridge := func(from, to *channel.Endpoint, outgoing bool) {
		defer wg.Done()
		for {
			p := from.ReadContext(ctx)
			if p == nil {
				return
			}
			v := p.ToView()
			raw := append([]byte(nil), v.AsSlice()...)
			v.Release()
			p.DecRef()
			h := tcpHeader(raw)
			if outgoing && armed.Load() && len(raw)-int(header.IPv4(raw).HeaderLength())-int(h.DataOffset()) > 0 {
				select {
				case packets <- raw:
				case <-ctx.Done():
					return
				}
				continue
			}
			inject(to, raw)
			if !outgoing && armed.Load() {
				select {
				case acks <- h.AckNumber():
				default:
				}
			}
		}
	}
	wg.Add(2)
	go bridge(al, bl, true)
	go bridge(bl, al, false)
	defer func() { cancel(); wg.Wait() }()
	listener, err := gonet.ListenTCP(b, tcpip.FullAddress{NIC: 1, Addr: tcpip.AddrFrom4([4]byte{10, 0, 0, 2}), Port: 8080}, ipv4.ProtocolNumber)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	client, err := gonet.DialContextTCP(ctx, a, tcpip.FullAddress{NIC: 1, Addr: tcpip.AddrFrom4([4]byte{10, 0, 0, 2}), Port: 8080}, ipv4.ProtocolNumber)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	server, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	deadline, _ := ctx.Deadline()
	client.SetDeadline(deadline)
	server.SetDeadline(deadline)
	// Warm up the sender and obtain its negotiated payload size before holding data.
	if _, err := client.Write([]byte{1}); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadFull(server, make([]byte, 1)); err != nil {
		t.Fatal(err)
	}
	var mss int
	for mss == 0 {
		select {
		case s := <-states:
			if s.SndUna == s.SndNxt && s.MaxPayloadSize > 0 {
				mss = s.MaxPayloadSize
			}
		case <-ctx.Done():
			t.Fatal("warmup ACK timeout")
		}
	}
	armed.Store(true)
	payload := bytes.Repeat([]byte{42}, 4*mss)
	if _, err := client.Write(payload); err != nil {
		t.Fatal(err)
	}
	held := make([][]byte, 4)
	for i := range held {
		select {
		case held[i] = <-packets:
		case <-ctx.Done():
			t.Fatal("data capture timeout")
		}
	}
	first := tcpHeader(held[0]).SequenceNumber()
	inject(bl, held[1]) // SACK segment two without entering recovery.
	for {
		select {
		case ack := <-acks:
			if ack == first {
				goto sacked
			}
		case <-ctx.Done():
			t.Fatal("SACK timeout")
		}
	}
sacked:
	inject(bl, held[0]) // Cumulative ACK covers segments one and two.
	for {
		select {
		case s := <-states:
			if uint32(s.SndUna) != first+uint32(2*mss) {
				continue
			}
			if s.FastRecovery.Active || s.Outstanding != 2 {
				t.Fatalf("after SACK then cumulative ACK: outstanding=%d, want=2; recovery=%v; flight=%d", s.Outstanding, s.FastRecovery.Active, uint32(s.SndNxt)-uint32(s.SndUna))
			}
			goto verified
		case <-ctx.Done():
			t.Fatal("cumulative ACK timeout")
		}
	}
verified:
	armed.Store(false)
	inject(bl, held[2])
	inject(bl, held[3])
	got := make([]byte, len(payload))
	if _, err := io.ReadFull(server, got); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(payload, got) {
		t.Fatal("payload changed")
	}
}
