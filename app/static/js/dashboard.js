const POLL_INTERVAL_MS = 10000;

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("poll-interval").textContent = POLL_INTERVAL_MS / 1000;
  setupTabs();
  refreshAll();
  setInterval(refreshAll, POLL_INTERVAL_MS);
});

function setupTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

async function fetchJSON(url) {
  const resp = await fetch(url);
  return resp.json();
}

function isUnavailable(data) {
  return data.error && [400, 404].includes(data.status);
}

function errorMessage(data, feature) {
  if (isUnavailable(data)) {
    return `${feature} is not available through this FortiOS API (${data.status})`;
  }
  return "Error reaching FortiGate";
}

function latestMetric(metric) {
  if (Array.isArray(metric)) return metric.at(-1);
  return metric;
}

function percentage(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number}%` : "n/a";
}

function resourceValue(metric, names) {
  if (typeof metric === "number") return metric;
  if (!metric || typeof metric !== "object") return undefined;
  for (const name of names) {
    if (metric[name] !== undefined) return metric[name];
  }
  return undefined;
}

function interfaceIp(ip) {
  if (Array.isArray(ip)) return ip.join(", ") || "-";
  if (typeof ip === "string") return ip || "-";
  return "-";
}

function setStatus(ok) {
  const el = document.getElementById("status-indicator");
  el.classList.remove("ok", "error");
  el.classList.add(ok ? "ok" : "error");
}

async function refreshAll() {
  try {
    await Promise.all([
      loadSystemStatus(),
      loadResourceUsage(),
      loadInterfaces(),
      loadSessions(),
      loadZtnaPolicies(),
      loadZtnaTags(),
      loadZtnaTrafficForwardProxy(),
    ]);
    setStatus(true);
  } catch (err) {
    console.error("Refresh failed", err);
    setStatus(false);
  }
}

async function loadSystemStatus() {
  const data = await fetchJSON("/api/system/status");
  const tbody = document.querySelector("#system-status-table tbody");
  tbody.innerHTML = "";
  if (data.error) {
    tbody.innerHTML = `<tr><td colspan="2">Error reaching FortiGate (${data.status || ""})</td></tr>`;
    return;
  }
  const results = data.results || {};
  const rows = {
    Hostname: results.hostname,
    "FortiOS Version": results.version,
    "Serial Number": results.serial,
    Model: results.model,
    Uptime: formatUptime(results.uptime || results.time),
  };
  for (const [label, value] of Object.entries(rows)) {
    tbody.innerHTML += `<tr><td>${label}</td><td>${value ?? "-"}</td></tr>`;
  }
}

function formatUptime(seconds) {
  if (typeof seconds !== "number") return "-";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${mins}m`;
}

async function loadResourceUsage() {
  const data = await fetchJSON("/api/system/resources");
  const el = document.getElementById("resource-usage");
  if (data.error) {
    el.innerHTML = "Error reaching FortiGate";
    return;
  }
  const results = data.results || {};
  const cpu = latestMetric(results.cpu);
  const mem = latestMetric(results.mem);
  const cpuValue = resourceValue(cpu, ["cpu", "cpu_usage", "cpu_user"]);
  const memoryValue = resourceValue(mem, ["mem", "memory", "memory_usage"]);
  el.innerHTML = `
    <p>CPU: <strong>${percentage(cpuValue)}</strong></p>
    <p>Memory: <strong>${percentage(memoryValue)}</strong></p>
  `;
}

async function loadInterfaces() {
  const data = await fetchJSON("/api/system/interfaces");
  const tbody = document.querySelector("#interfaces-table tbody");
  tbody.innerHTML = "";
  if (data.error) {
    tbody.innerHTML = `<tr><td colspan="5">Error reaching FortiGate</td></tr>`;
    return;
  }
  const results = data.results || {};
  Object.values(results).forEach((iface) => {
    const status = iface.link ? "up" : "down";
    tbody.innerHTML += `<tr>
      <td>${iface.name || "-"}</td>
      <td>${interfaceIp(iface.ip)}</td>
      <td><span class="badge ${status}">${status}</span></td>
      <td>${iface.rx_bytes ?? "-"}</td>
      <td>${iface.tx_bytes ?? "-"}</td>
    </tr>`;
  });
}

async function loadSessions() {
  const data = await fetchJSON("/api/system/sessions");
  const tbody = document.querySelector("#sessions-table tbody");
  tbody.innerHTML = "";
  if (data.error) {
    tbody.innerHTML = `<tr><td colspan="4">${errorMessage(data, "Active-session data")}</td></tr>`;
    return;
  }
  const results = data.results || [];
  results.slice(0, 50).forEach((s) => {
    tbody.innerHTML += `<tr>
      <td>${s.src || "-"}:${s.sport ?? ""}</td>
      <td>${s.dst || "-"}:${s.dport ?? ""}</td>
      <td>${s.proto ?? "-"}</td>
      <td>${s.policyid ?? "-"}</td>
    </tr>`;
  });
}

async function loadZtnaPolicies() {
  const data = await fetchJSON("/api/ztna/policies");
  const tbody = document.querySelector("#ztna-policies-table tbody");
  tbody.innerHTML = "";
  if (data.error) {
    tbody.innerHTML = `<tr><td colspan="5">${errorMessage(data, "ZTNA firewall-policy data")}</td></tr>`;
    return;
  }
  const results = data.results || [];
  if (results.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">No ZTNA-tagged policies found</td></tr>`;
    return;
  }
  results.forEach((p) => {
    tbody.innerHTML += `<tr>
      <td>${p.policyid ?? "-"}</td>
      <td>${p.name || "-"}</td>
      <td>${p["ztna-ems-tag"] ? JSON.stringify(p["ztna-ems-tag"]) : "-"}</td>
      <td><span class="badge enable">${p.status || "-"}</span></td>
      <td>${p.action || "-"}</td>
    </tr>`;
  });
}

async function loadZtnaTags() {
  const data = await fetchJSON("/api/ztna/tags");
  const tbody = document.querySelector("#ztna-tags-table tbody");
  tbody.innerHTML = "";
  if (data.error) {
    tbody.innerHTML = `<tr><td colspan="2">${errorMessage(data, "ZTNA EMS tag data")}</td></tr>`;
    return;
  }
  const results = data.results || [];
  if (results.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2">No ZTNA tag groups found</td></tr>`;
    return;
  }
  results.forEach((t) => {
    const members = (t.members || []).map((m) => m.name).join(", ");
    tbody.innerHTML += `<tr><td>${t.name || "-"}</td><td>${members || "-"}</td></tr>`;
  });
}

async function loadZtnaTrafficForwardProxy() {
  const data = await fetchJSON("/api/ztna/traffic-forward-proxy");
  const tbody = document.querySelector("#ztna-tfp-table tbody");
  tbody.innerHTML = "";
  if (data.error) {
    tbody.innerHTML = `<tr><td colspan="3">${errorMessage(data, "ZTNA traffic-forward-proxy data")}</td></tr>`;
    return;
  }
  const results = data.results || [];
  if (results.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3">No ZTNA traffic forward proxies configured</td></tr>`;
    return;
  }
  results.forEach((p) => {
    tbody.innerHTML += `<tr><td>${p.name || "-"}</td><td>${p.host || "-"}</td><td>${p.port ?? "-"}</td></tr>`;
  });
}
