# LAN Bonjour recovery verification

Issue: [#30](https://github.com/JosssphZhou/poki/issues/30).
Implementation tested: `6ac8da8`, based on `9ce5e5e` (including #19's RSD probe).
Subsequent commits update documentation only. Checks below were run on 2026-11-07.

## Current behavior

- Setup accepts and persists `.local` names alongside numeric IP addresses.
- Confirmed dead-tunnel recovery and explicit reconnect refresh Bonjour control
  connections, allowing the system resolver to select the current address.
- Numeric IPs, scoped IPv6 and other hostnames retain their existing control reuse.
- The data socket uses the authenticated control peer's address and IPv6 scope.
- Failed replacement preserves the working tunnel. Pairing and device identity
  checks remain enforced; uncertain input is never automatically replayed.

## Automated validation

| Check | Result |
| --- | --- |
| Full Node suite (`npm test`) | 145 passed |
| Updated setup regression, run separately | Passed |
| Full Rust suite (`cargo test --locked --manifest-path native/bridge/Cargo.toml`) | 24 passed |
| Native debug build, remote.rs rustfmt check, diff check | Passed |

Coverage includes hostname persistence and validation, Bonjour-only mode detection,
scoped IPv6, stale-control invalidation, explicit reconnect with a failed
replacement, and control reuse for IP/MagicDNS configurations. New control-refresh
and classification regressions were observed failing before their fixes.

The socket fixtures establish invalidation and preservation, not real mDNS or
RemotePairing authentication. The data-socket test exercises its extracted
connector, not the full authenticated connection path.
`failed_remote_replacement_keeps_the_working_tunnel` also passes on the base;
it protects the existing contract rather than demonstrating a newly fixed bug.

## Physical validation

Device: iPhone 15 Pro, iOS 27.2. The phone stayed unlocked with USB disconnected.
The user switched between the same router's 2.4 GHz and 5 GHz Wi-Fi networks;
system resolution confirmed changed IPv4 and IPv6 addresses. These are network
switches, not isolated same-SSID DHCP renewals; separate subnets were not established.
The tests used an isolated configuration with the actual Bonjour name and an
existing verified pairing record. No configuration edit, helper restart or
re-pairing occurred between each connected baseline and its post-switch requests.

| Scenario | Result |
| --- | --- |
| Explicit reconnect after address change | Wireless baseline read: 109 ms. First post-switch request, `reconnect`: success in 768 ms. Following `device_info`: success in 172 ms. |
| Poki Agent task after another address change | CLI autonomously navigated Settings → General → About and read iOS 27.2; independent Agent verification passed. Total: 85.404 s, 4 tool calls, 1 navigation error recovered without intervention. |

The explicit-reconnect test used native requests through Poki's transport wrapper.
The Agent test used the final implementation through an isolated daemon, with no
manual reconnect or supplemental phone actions after the switch. The navigation
error was a lookup for General while Settings was still on the Wi-Fi page.

## Limits

These are individual successful runs, not latency or long-duration reliability
claims. Internal reset/resolution events were not independently traced; their
ordering is supported by source review and socket regressions.

Same-SSID DHCP renewal, renamed hosts, changed advertised ports, multiple phones,
cross-network Bonjour and IPv6 scope migration remain untested. IP/Tailscale
compatibility is regression-tested, not revalidated over cellular. Simulator
hardware validation is outside these checks. Ordinary recovery still depends on
the existing transport/RSD timeouts. Setup requires a trusted, reachable phone;
revoking its connection to the Mac requires restoring trust before testing.

No pairing records, device identifiers, raw network addresses or phone screenshots
are included in this document.
