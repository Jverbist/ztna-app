"""
Async client wrapping the FortiGate REST API.

Uses a Bearer API token (create via System > Administrators > REST API Admin
on the FortiGate, restrict the Trusted Host to the Ubuntu VM's IP).
"""
import os
import logging
from typing import Any

import httpx

logger = logging.getLogger("fortigate_client")

FORTIGATE_HOST = os.getenv("FORTIGATE_HOST", "10.60.10.1")
FORTIGATE_PORT = os.getenv("FORTIGATE_PORT", "443")
FORTIGATE_TOKEN = os.getenv("FORTIGATE_TOKEN", "")
VERIFY_TLS = os.getenv("FORTIGATE_VERIFY_TLS", "false").lower() == "true"

BASE_URL = f"https://{FORTIGATE_HOST}:{FORTIGATE_PORT}"


class FortiGateClient:
    """Thin async wrapper around the FortiGate REST API (v2)."""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=BASE_URL,
            verify=VERIFY_TLS,
            timeout=10.0,
            headers={"Authorization": f"Bearer {FORTIGATE_TOKEN}"},
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def _get(self, path: str, params: dict | None = None) -> dict[str, Any]:
        try:
            resp = await self._client.get(path, params=params)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error("FortiGate API error %s: %s", exc.response.status_code, path)
            return {"error": True, "status": exc.response.status_code, "path": path}
        except httpx.RequestError as exc:
            logger.error("FortiGate API request failed for %s: %s", path, exc)
            return {"error": True, "status": None, "path": path, "message": str(exc)}

    async def _get_first_available(self, paths: list[str]) -> dict[str, Any]:
        """Try endpoint aliases used by different FortiOS releases."""
        last_result: dict[str, Any] = {}
        for path in paths:
            result = await self._get(path)
            if not result.get("error"):
                return result
            last_result = result
        return last_result

    # ---- System health ----------------------------------------------------

    async def system_status(self) -> dict[str, Any]:
        return await self._get("/api/v2/monitor/system/status")

    async def system_resources(self) -> dict[str, Any]:
        return await self._get(
            "/api/v2/monitor/system/resource/usage",
            params={"scope": "global", "interval": "1-min"},
        )

    async def interfaces(self) -> dict[str, Any]:
        return await self._get("/api/v2/monitor/system/interface")

    # ---- ZTNA specific ------------------------------------------------------

    async def ztna_firewall_policies(self) -> dict[str, Any]:
        """Firewall policies that carry ztna-tags / ztna-ems-tag-secondary."""
        return await self._get("/api/v2/cmdb/firewall/policy")

    async def ztna_proxy_policies(self) -> dict[str, Any]:
        """ZTNA proxy (traffic forwarding) policies, if configured."""
        return await self._get("/api/v2/cmdb/firewall/proxy-policy")

    async def ztna_tags(self) -> dict[str, Any]:
        """EMS/ZTNA tag groups synced from FortiClient EMS."""
        return await self._get_first_available(
            [
                "/api/v2/cmdb/firewall/ztna-ems-tag",
                "/api/v2/cmdb/firewall/ztna-tag-groups",
            ]
        )

    async def ztna_traffic_forward_servers(self) -> dict[str, Any]:
        return await self._get("/api/v2/cmdb/firewall/ztna-traffic-forward-proxy")

    async def active_sessions(self) -> dict[str, Any]:
        return await self._get(
            "/api/v2/monitor/firewall/session", params={"count": 200}
        )


fortigate_client = FortiGateClient()
