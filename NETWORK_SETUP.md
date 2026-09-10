# Network Setup & Troubleshooting

This document records the CloudShare/FortiGate lab network topology used for
the ZTNA demonstration dashboard, and the routing/firewall steps required to
get the Ubuntu VM talking to the FortiGate REST API.

## Topology overview

| Component            | IP address           | Notes                                              |
|-----------------------|-----------------------|-----------------------------------------------------|
| FortiGate1 (management)| `10.60.10.1` (port1 "Management") | GUI/API admin access, also has HA admin port `10443` |
| FortiGate1 (Routing side) | `172.16.1.254` (port9 "4G") | Directly connected to the same subnet as the Ubuntu VM |
| FortiClient EMS        | `10.60.10.120`        | ZTNA tag source, not queried directly by the dashboard |
| Ubuntu VM (Docker host) | `172.16.1.2` (`ens160`, "Routing" network) | Runs the ZTNA dashboard + WAN simulator containers |
| Ubuntu VM (virtual WAN side) | `172.16.1.3` (`ens192`, "WAN2" network) | Used by the WAN simulator container, isolated subnet despite same `/24` numbering |
| CloudShare gateway (Routing network) | `172.16.1.1` | CloudShare's own infrastructure gateway for that virtual network segment - **not** part of the FortiGate lab routing path |

> Important: `172.16.1.1` and `172.16.1.254` are **not** the same device.
> `172.16.1.1` is CloudShare's own vSwitch/gateway for the "Routing" virtual
> network (visible in the CloudShare portal under Networks > Routing >
> CloudShare Gateway IP). `172.16.1.254` is FortiGate1's own `4G (port9)`
> interface, directly connected on the same subnet as the Ubuntu VM.

## Problem: dashboard couldn't reach the FortiGate API

Symptoms observed while debugging:

1. `ping 10.60.10.1` and `curl https://10.60.10.1` from the Ubuntu VM timed out.
2. `ip route show` revealed the only default route pointed at `172.16.1.66`
   via `ens192`, which was `linkdown` — there was no explicit route to
   `10.60.10.0/24` (FortiGate1's Management subnet) at all.
3. Adding a route via the CloudShare gateway (`172.16.1.1`) resolved at Layer
   2 (ARP succeeded) but still timed out at the TCP level — CloudShare's
   gateway does not route to the internal Management subnet.
4. Checking FortiGate1's own interface list showed a `4G (port9)` interface
   directly on `172.16.1.0/24` (`172.16.1.254/24`) — the real, directly
   connected path from the Ubuntu VM to FortiGate1.
5. Even after routing directly to `172.16.1.254`, HTTPS still timed out
   because:
   - `4G (port9)` only had **PING** enabled under Administrative Access (no
     HTTPS) — local-in traffic destined for the FortiGate's own IP is
     governed by the *arrival* interface's administrative access settings,
     not by regular firewall policies.
   - The FortiGate admin HTTPS port for this lab is **`10443`**, not the
     default `443`.

## Fix applied

1. **Add a static route on the Ubuntu VM** for the Management subnet via
   FortiGate1's directly connected `4G` interface:
   ```bash
   sudo ip route add 10.60.10.0/24 via 172.16.1.254 dev ens160
   ```
   This is a runtime-only route (lost on reboot). To persist it, add it to
   Netplan (see below).

2. **Enable HTTPS administrative access** on FortiGate1's `4G (port9)`
   interface (Network > Interfaces > 4G (port9) > Administrative Access >
   enable HTTPS, keep PING enabled).

3. **Create a firewall policy** allowing traffic from the `4G` interface to
   the `Management` interface (needed for any transit/API traffic, even
   between interfaces on the same device):
   ```
   config firewall policy
       edit 0
           set name "api-policy"
           set srcintf "any"
           set dstintf "Management"
           set srcaddr "all"
           set dstaddr "all"
           set action accept
           set schedule "always"
           set service "HTTPS" "PING"
       next
   end
   ```

4. **Use the correct admin HTTPS port** — this lab's FortiGate admin GUI/API
   is served on **`10443`**, not `443`:
   ```bash
   curl -k -m 5 -v https://10.60.10.1:10443/logincheck
   ```

5. Updated `.env` on the Ubuntu VM:
   ```
   FORTIGATE_HOST=10.60.10.1
   FORTIGATE_PORT=10443
   ```
   Then restarted the backend container:
   ```bash
   sudo docker compose restart fastapi
   ```

## Persisting the static route (survives reboot)

Runtime `ip route add` commands are lost on reboot. To persist, add a route
to Netplan on the Ubuntu VM (adjust the config file name/interface to match
your setup, typically under `/etc/netplan/`):

```yaml
network:
  version: 2
  ethernets:
    ens160:
      routes:
        - to: 10.60.10.0/24
          via: 172.16.1.254
```

Apply with:
```bash
sudo netplan apply
```

## Useful diagnostic commands

```bash
ip addr                                  # interface states/MTU
ip route show                            # routing table
ip route get 10.60.10.1                  # which route/gateway is chosen
ip neigh show 172.16.1.254               # ARP/L2 reachability of a gateway
curl -k -m 5 -v https://10.60.10.1:10443/logincheck   # TCP/TLS-level test, bypasses ICMP filtering
sudo docker compose logs fastapi --tail 50            # see FortiGate API errors from the app
```
