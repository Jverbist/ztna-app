# Fortinet ZTNA Demonstration Dashboard

A containerized dashboard that reads live data from a FortiGate via its REST
API and displays system health + ZTNA-specific information (policies, EMS tag
groups, traffic-forward proxies, active sessions).

Built for a CloudShare lab environment:

- FortiGate management IP: `10.60.10.1`
- FortiClient EMS: `10.60.10.120`
- Ubuntu VM (Docker host): `172.16.1.2` (WAN sim already using host ports `80`/`8080`)
- Virtual WAN interface: `172.16.1.3`

The dashboard is exposed on **alternate host ports** so it doesn't conflict
with the existing WAN simulator container:

| Service        | Host port | Notes                                   |
|----------------|-----------|------------------------------------------|
| Nginx (HTTP)   | 8880      | Redirects to HTTPS                        |
| Nginx (HTTPS)  | 8443      | TLS termination, serves `ztna.demo.local` |
| FastAPI        | (internal)| Not published to host, only via Nginx     |

## 1. Prerequisites on the Ubuntu VM

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin openssl
```

## 2. Clone this repo on the Ubuntu VM

```bash
git clone <your-repo-url> ztna-dashboard
cd ztna-dashboard
```

## 3. Create a read-only FortiGate REST API admin

On the FortiGate GUI (or CLI), create a dedicated API admin restricted to the
Ubuntu VM's IP:

1. **System > Admin Profiles**: create a profile (e.g. `ztna-dashboard-ro`)
   with **Read-Only** access to at least: System, Network, Firewall, Log & Report.
2. **System > Administrators > New > REST API Admin**:
   - Username: `ztna-dashboard`
   - Administrator profile: `ztna-dashboard-ro`
   - Trusted Hosts: `172.16.1.2/32` (restrict to only the Ubuntu VM)
3. After creation, the FortiGate shows a one-time **API token** — copy it.

CLI equivalent:
```
config system accprofile
    edit "ztna-dashboard-ro"
        set sysgrp read
        set netgrp read
        set fwgrp read
        set loggrp read
    next
end

config system api-user
    edit "ztna-dashboard"
        set accprofile "ztna-dashboard-ro"
        set trusthost1 172.16.1.2 255.255.255.255
    next
end
execute api-user generate-key ztna-dashboard
```

## 4. Configure environment variables

```bash
cp .env.example .env
nano .env
```

Set `FORTIGATE_HOST=10.60.10.1` and paste the API token into `FORTIGATE_TOKEN`.
Leave `FORTIGATE_VERIFY_TLS=false` unless you've installed a trusted cert on
the FortiGate's admin GUI. Double check `FORTIGATE_PORT` — some labs move the
admin HTTPS port off the default `443` (this lab uses `10443`).

> If the backend can't reach the FortiGate (see `docker compose logs
> fastapi`), see [NETWORK_SETUP.md](./NETWORK_SETUP.md) for routing/firewall
> troubleshooting steps specific to this CloudShare lab topology.

## 5. Generate the local self-signed TLS certificate

```bash
chmod +x nginx/generate-cert.sh
./nginx/generate-cert.sh
```

This creates `nginx/certs/ztna.demo.local.crt/.key` (git-ignored).

## 6. Add the local domain to your client machine's hosts file

On the machine you'll use to *browse* to the dashboard (e.g. "IT Workstation
1" from the network diagram), add:

```
172.16.1.2   ztna.demo.local
```

- Linux/macOS: `/etc/hosts`
- Windows: `C:\Windows\System32\drivers\etc\hosts`

## 7. Build and run

```bash
docker compose up -d --build
docker compose ps
```

Browse to **https://ztna.demo.local:8443** (accept the self-signed cert
warning). The existing WAN simulator container keeps working unaffected on
ports 80/8080.

## 8. Verify

```bash
docker compose logs -f fastapi   # check for FortiGate API 200 responses
curl -k https://ztna.demo.local:8443/healthz
```

## Project layout

```
ztna-dashboard/
├── docker-compose.yml
├── .env.example
├── app/                      # FastAPI backend + HTML/JS frontend
│   ├── main.py
│   ├── fortigate_client.py
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── templates/index.html
│   └── static/{css,js}
└── nginx/
    ├── nginx.conf
    ├── generate-cert.sh
    └── certs/                # generated, git-ignored
```

## Notes / things to double check in your lab

- If your FortiOS version doesn't expose `firewall/ztna-tag-groups` or
  `firewall/ztna-traffic-forward-proxy` (older FortiOS releases), those tabs
  will simply show "feature may not be licensed/configured" — this is
  expected and non-fatal.
- FortiClient EMS (10.60.10.120) is not queried directly in this version;
  ZTNA tag data is read from the FortiGate, which syncs tags from EMS. Let me
  know if you also want direct EMS API integration.
- Routing: confirm the Ubuntu VM (172.16.1.2) has a route to 10.60.10.0/24
  (management network) so the FastAPI container can reach the FortiGate.
