# Accessing Localhost from Mobile on Isolated Networks

> How to reach your Mac's local dev server from your phone when hotel/public WiFi isolates devices

## Problem

You're developing a mobile web app and need to test it on your phone. You're on a hotel or public WiFi network that uses AP isolation (client isolation) — a security feature that prevents devices on the same network from communicating with each other.

Your phone can't reach `http://192.168.x.x:3847` on your Mac because the network blocks device-to-device traffic.

## Challenge

Most solutions assume you're on a home/office network where devices can see each other. Hotel networks, coffee shops, and airports almost always isolate clients for security reasons.

## Solutions

### Option 1: Phone Hotspot (Recommended for Quick Testing)

Turn your phone into a WiFi hotspot and connect your Mac to it.

```bash
# On Mac, after connecting to phone's hotspot:
ipconfig getifaddr en0   # Get Mac's IP on the hotspot network
# Result: something like 172.20.10.2

# On phone browser:
# http://172.20.10.2:3847
```

**Pros**: Simple, instant, both devices on same network
**Cons**: Uses mobile data, drains phone battery

### Option 2: USB Tethering

Connect phone to Mac via Lightning/USB-C cable and enable USB tethering.

- iPhone: Settings → Personal Hotspot → Allow Others to Join
- Android: Settings → Network → Hotspot & Tethering → USB Tethering

```bash
# Find the USB network interface
ifconfig | grep -A5 "bridge"
# or
ipconfig getifaddr bridge100
```

**Pros**: No WiFi needed, phone charges while connected
**Cons**: Phone must be physically connected

### Option 3: Tailscale (Recommended for Regular Use)

Install Tailscale on both Mac and phone. Both join your private mesh VPN.

```bash
# Install on Mac
brew install tailscale

# Get your Tailscale IP
tailscale ip -4
# Result: 100.x.x.x

# On phone browser:
# http://100.x.x.x:3847
```

**Pros**: Works from anywhere (even different countries), encrypted, zero-config
**Cons**: Requires account setup, app on both devices

### Option 4: ngrok (Works Through Any Network)

Expose your local server via a public URL tunnel.

```bash
# Install
brew install ngrok

# Expose port 3847
ngrok http 3847
# Result: https://abc123.ngrok.io
```

**Pros**: Works through any network, no device configuration
**Cons**: Public URL (security risk), requires ngrok account for custom domains, free tier has limits

### Option 5: Mac Internet Sharing

Create a private WiFi network from your Mac that your phone can join.

System Preferences → Sharing → Internet Sharing:
- Share your connection from: Ethernet (or Thunderbolt)
- To computers using: Wi-Fi

**Pros**: Creates isolated private network
**Cons**: Complex setup, may conflict with existing WiFi, Mac needs wired internet

## Key Insight

For development and testing, **Tailscale** is the best long-term investment. Five minutes of setup gives you secure access to your dev machine from anywhere — hotel rooms, airports, or across the world. The 100.x.x.x IP works like a local network but over the internet.

For quick one-off testing, **phone hotspot** is fastest — no setup, just flip a switch.

## Gotchas

- Hotel "same network" isn't actually the same network — AP isolation is standard
- `localhost` and `127.0.0.1` only work on the same machine
- `.local` hostnames (Bonjour) require mDNS which isolated networks often block
- Firewall may block incoming connections — check System Preferences → Security

## References

- [Tailscale Quickstart](https://tailscale.com/kb/1017/install/)
- [ngrok Documentation](https://ngrok.com/docs)
- [AP Isolation Explained](https://en.wikipedia.org/wiki/Wireless_network_security#Client_isolation)

---

*Discovered: 2026-01-13*
