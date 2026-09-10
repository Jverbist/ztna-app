"""
FortiGate ZTNA demonstration dashboard - FastAPI backend.

Serves a small HTML/JS dashboard and a JSON API that proxies data from the
FortiGate REST API (system health + ZTNA specific views).
"""
import logging
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request

load_dotenv()

from fortigate_client import fortigate_client  # noqa: E402  (needs env loaded first)

logging.basicConfig(level=logging.INFO)

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="ZTNA Demonstration Dashboard")

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")


@app.on_event("shutdown")
async def shutdown_event() -> None:
    await fortigate_client.close()


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


# ---- System health API -----------------------------------------------------

@app.get("/api/system/status")
async def api_system_status():
    return await fortigate_client.system_status()


@app.get("/api/system/resources")
async def api_system_resources():
    return await fortigate_client.system_resources()


@app.get("/api/system/interfaces")
async def api_system_interfaces():
    return await fortigate_client.interfaces()


@app.get("/api/system/sessions")
async def api_system_sessions():
    return await fortigate_client.active_sessions()


# ---- ZTNA API ---------------------------------------------------------------

@app.get("/api/ztna/policies")
async def api_ztna_policies():
    data = await fortigate_client.ztna_firewall_policies()
    if data.get("error"):
        return data
    # Only keep policies that actually use ZTNA tagging, to reduce noise.
    results = data.get("results", [])
    ztna_policies = [
        p
        for p in results
        if p.get("ztna-ems-tag") or p.get("ztna-tags-match-logic") or p.get("ztna-status") == "enable"
    ]
    return {"count": len(ztna_policies), "results": ztna_policies}


@app.get("/api/ztna/proxy-policies")
async def api_ztna_proxy_policies():
    return await fortigate_client.ztna_proxy_policies()


@app.get("/api/ztna/tags")
async def api_ztna_tags():
    return await fortigate_client.ztna_tags()


@app.get("/api/ztna/traffic-forward-proxy")
async def api_ztna_traffic_forward_proxy():
    return await fortigate_client.ztna_traffic_forward_servers()
