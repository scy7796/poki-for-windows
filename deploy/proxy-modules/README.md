# Proxy modules: the 10.7.0.1 loopback

Poki on the phone talks to the phone's own developer services (lockdown on 62078, RemotePairing on
49152) at 10.7.0.1. Something on the phone has to send connections to 10.7.0.1 straight back to the
phone. Poki's built-in connection does that with a VPN of its own. iOS allows only one VPN at a time,
so someone who already runs a proxy app can let it do the same instead, with the setups below, and keep
their VPN. Keep the address at 10.7.0.1: Shadowrocket hard-codes it, and SideStore-style tools use the
same one.

The reflect swaps the addresses only, not the ports: a connection to 10.7.0.1:49152 arrives at the
phone's own port 49152. Each setup below also keeps IPv6 off on the proxy's tunnel interface,
because tools that look for this loopback skip a tunnel interface that has an IPv6 address. Poki
Probe (`native/ios-runner/PokiProbe`) shows whether the loopback works: the 10.7.0.x interface,
whether it has IPv6, and a TCP connect to 10.7.0.1 on both ports.

## Surge (iOS 5.23.0 or later)

Install [`poki-loopback.sgmodule`](poki-loopback.sgmodule) as a module and enable it. Enhanced Mode
must be on: `[IP Rewrite]` only applies to traffic in Surge's VIF, so reflect does nothing in plain
proxy mode. The module turns off `ipv6-vif` and adds 10.7.0.1/32 to `tun-included-routes`, so the
address reaches the VIF even if it falls in an excluded or local range.
Reference: [Surge manual, IP Rewrite](https://manual.nssurge.com/features/ip-rewrite.html).

## Loon (3.5.3, build 1007, or later)

Import [`poki-loopback.lpx`](poki-loopback.lpx) as a plugin and enable it. `include-tun` sends
10.7.0.1 into Loon's TUN, and `[IP Rewrite]` reflects it. The IP Rewrite line has to come from a
plugin, not the main configuration. The plugin's `loon_version` stops older Loon from accepting it
without supporting it. Reference: [Loon include-tun](https://nsloon.app/docs/General/#include-tun).

## sing-box (1.12.0 or later)

Add `"loopback_address": ["10.7.0.1"]` to the existing `tun` inbound. The `"type": "tun"` inbound
in [`sing-box-loopback.json`](sing-box-loopback.json) shows where it goes; merge that key into your
own inbound rather than replacing it. Leave IPv6 out of the tun `address` list. sing-box's loopback
handles TCP only, which is all Poki needs. Reference:
[sing-box tun inbound](https://sing-box.sagernet.org/configuration/inbound/tun/).

## Shadowrocket

No file is needed: turn on Settings > Other > "Include route 10.7.0.1/32". (Taken from the app's
settings as reported to us; not checked against Shadowrocket documentation. The SideStore community
reports the same switch: [shadowrocket-sidestore-rules #1](https://github.com/nikiz24/shadowrocket-sidestore-rules/pull/1).)

## Quantumult X (reported, not documented)

Add `reflected_routes = 10.7.0.1/32` to the `[general]` section of the profile and reconnect.
Reported by WrapPin's users ([WrapPin issue 36](https://github.com/suversal/WrapPin/issues/36),
October 2026); Quantumult X's own sample configuration and App Store notes do not list the key, and
its minimum version is unknown. The App Store lists 1.8.1 (October 2026) as the current version.

## Stash (reported, not documented)

Users tell us Stash has the loopback built in. Stash is mihomo-based, so the setting is expected
where Clash Mi has it: in the `tun` section of an override, `loopback-address: [10.7.0.1]`. Stash's
documentation (release notes through 3.4.0, the example configuration, the LAN proxy page) does not
mention it, so the app's own TUN or override settings are the place to look. Poki shows the
override lines and marks the entry "as reported".

## Clash Mi and other mihomo apps (reported, not documented)

Add to the profile's `tun` section:

```yaml
tun:
  loopback-address:
    - 10.7.0.1
```

Import the profile and connect. The key is not in the mihomo TUN documentation; it is reported
working for SideStore on iOS 26.3 and failing on 26.4 ([SideStore issue 1200](https://github.com/SideStore/SideStore/issues/1200)),
and a SideInstaller user reports the same on other mihomo-kernel apps
([SideInstaller issue 30](https://github.com/FrizzleM/SideInstaller/issues/30)). Poki's live check tells.

## Egern

WrapPin lists Egern among the apps that can carry the 10.7.0.1 tunnel, but Egern's configuration
reference documents only `vif_included_routes` and no reflect or loopback option, so Poki has no
Egern entry yet. If you know the setting, open an issue with it.

## LocalDevVPN and StosVPN

Not proxy apps: dedicated loopback VPNs from the SideStore community (LocalDevVPN is on the App
Store, id6755608044; StosVPN is its predecessor). Either replaces the proxy-app setup when the person
runs no proxy, at the cost of taking the phone's one VPN slot.

## Karing

Use Karing's existing VPN rather than enabling Poki's built-in local VPN. In Karing's TUN settings,
set **Loopback address** (`loopback_address`) to `10.7.0.1` and reconnect Karing. In Poki select
**External app**. This adds no second VPN configuration for Poki. Keep the existing subscription,
nodes and routing rules; the developer-service check in Poki must pass before continuing.

Karing's maintainer marked iOS loopback support complete in
[issue 899](https://github.com/KaringX/karing/issues/899), pointing to version `1.2.4.862`.
Source support does not replace device verification of the installed version, its route exclusions,
normal proxy access and Poki's launcher. Do not claim all VPN apps are compatible: those without
local reflection cannot share this path with Poki's packet-tunnel VPN.
