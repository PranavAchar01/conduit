(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  // ── State ─────────────────────────────────────────────────
  let catalog = [];
  let activeConnectors = [];
  let mcpSession = null;
  let apiKey = localStorage.getItem("conduit_api_key") || "";
  let reqId = 1;

  const ICONS = {
    hackernews: "🔶", obsidian: "💎", notion: "📝", github: "🐙",
    slack: "💬", linear: "📐", airtable: "📊", discord: "🎮",
    todoist: "✅", jira: "🔵",
  };
  const SVC_COLORS = {
    hackernews: "#f97316", obsidian: "#7c3aed", notion: "#e2e8f0",
    github: "#94a3b8", slack: "#4ade80", linear: "#5b5bd6",
    airtable: "#22d3ee", discord: "#818cf8", todoist: "#ef4444", jira: "#06b6d4",
  };

  // ── View management ───────────────────────────────────────
  function showView(id) {
    $("#view-home").style.display = id === "home" ? "" : "none";
    $("#view-chat").style.display = id === "chat" ? "" : "none";
  }

  // ── WebSocket ─────────────────────────────────────────────
  function connectWS() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}`);
    const foot = $("#conn");
    ws.onopen = () => { foot.textContent = "connected"; foot.className = "connected"; };
    ws.onmessage = (m) => { try { handleWSEvent(JSON.parse(m.data)); } catch {} };
    ws.onclose = () => {
      foot.textContent = "disconnected — retrying…";
      foot.className = "disconnected";
      setTimeout(connectWS, 2000);
    };
  }

  function handleWSEvent(ev) {
    switch (ev.type) {
      case "tool_count": setToolCount(ev.count); break;
      case "connector_added": onConnectorAdded(ev.name, ev.toolCount); break;
      case "connector_failed": appendPipelineLog(`✗ ${ev.name}: ${ev.error}`, "fail"); break;
      case "pipeline": updateStage(ev.stage, ev.status, ev.detail); break;
      case "log": appendPipelineLog(ev.text); break;
    }
  }

  // ── MCP client ────────────────────────────────────────────
  function mcpHeaders() {
    const h = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
    if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
    if (mcpSession) h["Mcp-Session-Id"] = mcpSession;
    return h;
  }

  async function mcpPost(method, params = {}) {
    const id = reqId++;
    const res = await fetch("/mcp", {
      method: "POST",
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });

    if (res.status === 401) {
      const key = prompt("Enter your Conduit API key:");
      if (!key) throw new Error("Unauthorized");
      apiKey = key;
      localStorage.setItem("conduit_api_key", key);
      return mcpPost(method, params);
    }

    const sid = res.headers.get("Mcp-Session-Id");
    if (sid) mcpSession = sid;

    const text = await res.text();
    // SSE response: parse last data: line
    let parsed = null;
    for (const chunk of text.split("\n\n")) {
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          try { parsed = JSON.parse(line.slice(6)); } catch {}
        }
      }
    }
    // Fallback: plain JSON
    if (!parsed) { try { parsed = JSON.parse(text); } catch {} }
    return parsed;
  }

  async function initMCP() {
    const res = await mcpPost("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "conduit-dashboard", version: "1.0" },
    });
    if (res?.result) {
      // Send initialized notification (fire and forget)
      fetch("/mcp", { method: "POST", headers: mcpHeaders(),
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) });
    }
  }

  async function callTool(name, args = {}) {
    if (!mcpSession) await initMCP();
    const res = await mcpPost("tools/call", { name, arguments: args });
    return res?.result;
  }

  // ── Tool count ────────────────────────────────────────────
  function setToolCount(n) {
    const el = $("#toolCount");
    if (!el || String(n) === el.textContent) return;
    el.textContent = n;
    el.classList.add("bump");
    setTimeout(() => el.classList.remove("bump"), 250);
  }

  // ── Catalog ───────────────────────────────────────────────
  async function loadCatalog() {
    try {
      const res = await fetch("/catalog");
      catalog = await res.json();
    } catch {}
    renderCatalog();
  }

  async function loadConnectors() {
    try {
      const res = await fetch("/connectors");
      activeConnectors = await res.json();
    } catch {}
    renderActiveConnectors();
    renderCatalog(); // refresh connected state
  }

  function renderCatalog() {
    const grid = $("#catalog-grid");
    if (!grid) return;
    if (!catalog.length) { grid.innerHTML = '<div class="catalog-loading">No services in catalog.</div>'; return; }

    grid.innerHTML = "";
    for (const svc of catalog) {
      const connected = activeConnectors.some((c) => c.name === svc.id);
      const needsCreds = svc.envVars && svc.envVars.length > 0;
      const color = SVC_COLORS[svc.id] || "var(--accent)";
      const icon = ICONS[svc.id] || "🔌";

      const card = document.createElement("div");
      card.className = "service-card" + (connected ? " connected" : "");
      card.style.setProperty("--svc-color", color);
      card.innerHTML = `
        <span class="svc-icon">${icon}</span>
        <div class="svc-name">${svc.name}</div>
        <div class="svc-desc">${svc.description}</div>
        <div class="svc-footer">
          <span class="badge ${needsCreds ? "badge-key" : "badge-free"}">${needsCreds ? "Needs API key" : "No setup"}</span>
          <button class="svc-btn${connected ? " connected" : ""}">${connected ? "Connected ✓" : "Connect"}</button>
        </div>
      `;
      if (!connected) card.addEventListener("click", () => openConnectModal(svc));
      grid.appendChild(card);
    }
  }

  function renderActiveConnectors() {
    const section = $("#active-section");
    const container = $("#active-connectors");
    if (!section || !container) return;

    if (!activeConnectors.length) { section.style.display = "none"; return; }
    section.style.display = "";
    container.innerHTML = "";

    for (const conn of activeConnectors) {
      const pill = document.createElement("div");
      pill.className = "connector-pill";
      pill.innerHTML = `
        <span class="pill-dot"></span>
        <span>${conn.name}</span>
        <span class="pill-count">${conn.tools.length} tools</span>
      `;
      container.appendChild(pill);
    }
  }

  function onConnectorAdded(name, toolCount) {
    if (!activeConnectors.find((c) => c.name === name)) {
      activeConnectors.push({ name, tools: Array(toolCount).fill({}) });
      renderActiveConnectors();
      renderCatalog();
    }
  }

  // ── Pipeline ──────────────────────────────────────────────
  function showPipelineSection() { $("#pipeline-section").style.display = ""; }

  function resetPipeline() {
    $$(".pipeline li").forEach((li) => {
      li.className = "";
      li.removeAttribute("data-status");
      li.querySelector(".stage-detail").textContent = "";
    });
    const log = $("#pipeline-log");
    if (log) log.innerHTML = "";
  }

  function updateStage(name, status, detail) {
    // Home pipeline + modal pipeline
    for (const scope of ["", "#modal-pipeline "]) {
      const li = $(`${scope}.pipeline li[data-stage="${name}"]`);
      if (!li) continue;
      li.className = "active";
      li.setAttribute("data-status", status || "start");
      if (detail) li.querySelector(".stage-detail").textContent = detail;
    }
  }

  function appendPipelineLog(text, type) {
    const cls = type === "fail" ? "log-fail" : /pass|ok|live|✓/i.test(text) ? "log-ok" : /warn|skip/i.test(text) ? "log-warn" : "";
    for (const id of ["#pipeline-log", "#modal-log"]) {
      const el = $(id);
      if (!el) continue;
      const span = document.createElement("span");
      span.className = cls;
      span.textContent = text + "\n";
      el.appendChild(span);
      el.scrollTop = el.scrollHeight;
    }
  }

  // ── Modal ─────────────────────────────────────────────────
  function showModal() { $("#modal-bg").style.display = ""; }
  function hideModal() { $("#modal-bg").style.display = "none"; }

  function openConnectModal(svc) {
    const body = $("#modal-body");
    const needsCreds = svc.envVars && svc.envVars.length > 0;
    const icon = ICONS[svc.id] || "🔌";

    if (!needsCreds) {
      body.innerHTML = buildPipelineModalHTML(`${icon} Connecting ${svc.name}…`);
      showModal();
      runConnect(svc.id, {});
      return;
    }

    const fields = svc.envVars.map((ev) => `
      <div class="field">
        <label>${ev.key}${ev.required ? " *" : ""}</label>
        <input type="password" name="${ev.key}"
          placeholder="${ev.description}" ${ev.required ? "required" : ""} />
      </div>
    `).join("");

    body.innerHTML = `
      <h3 class="modal-title">${icon} Connect ${svc.name}</h3>
      <p class="modal-desc">${svc.description}</p>
      <form id="connect-form">
        ${fields}
        <button type="submit" class="btn-connect">Connect →</button>
      </form>
    `;
    showModal();

    $("#connect-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const config = {};
      for (const ev of svc.envVars) {
        const val = e.target.elements[ev.key]?.value?.trim();
        if (val) config[ev.key] = val;
      }
      body.innerHTML = buildPipelineModalHTML(`${icon} Connecting ${svc.name}…`);
      runConnect(svc.id, config);
    });
  }

  function buildPipelineModalHTML(title) {
    return `
      <h3 class="modal-title">${title}</h3>
      <div class="pipeline-wrap">
        <ol class="pipeline" id="modal-pipeline">
          <li data-stage="generate"><span class="dot"></span><span class="stage-name">generate</span><span class="stage-detail"></span></li>
          <li data-stage="scan"><span class="dot"></span><span class="stage-name">Opsera scan</span><span class="stage-detail"></span></li>
          <li data-stage="sandbox"><span class="dot"></span><span class="stage-name">sandbox / smoke</span><span class="stage-detail"></span></li>
          <li data-stage="register"><span class="dot"></span><span class="stage-name">register + hot-load</span><span class="stage-detail"></span></li>
        </ol>
        <pre id="modal-log" class="pipeline-log"></pre>
      </div>
    `;
  }

  async function runConnect(serviceId, config) {
    showPipelineSection();
    resetPipeline();

    try {
      const result = await callTool("conduit__connect_service", { service: serviceId, config });
      const text = result?.content?.[0]?.text || "";
      let data;
      try { data = JSON.parse(text); } catch { data = {}; }

      if (data.registered) {
        appendPipelineLog(`✓ ${data.name || serviceId} is live — ${data.toolCount || "?"} tools`);
        setTimeout(() => { hideModal(); loadConnectors(); }, 2000);
      } else {
        appendPipelineLog(`✗ ${data.error || "Generation failed"}`, "fail");
      }
    } catch (err) {
      appendPipelineLog(`✗ ${err.message}`, "fail");
    }
  }

  // ── Chat ──────────────────────────────────────────────────
  function addMsg(role, html) {
    const msgs = $("#chat-messages");
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.innerHTML = `
      <div class="msg-avatar">${role === "bot" ? "⌁" : "▲"}</div>
      <div class="msg-bubble">${html}</div>
    `;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function handleChat(text) {
    addMsg("user", esc(text));

    const lower = text.toLowerCase();
    const matched = catalog.find((svc) =>
      lower.includes(svc.id) || lower.includes(svc.name.toLowerCase())
    );

    if (matched) {
      const needsCreds = matched.envVars && matched.envVars.length > 0;
      addMsg("bot", `Connecting <strong>${matched.name}</strong>… ${needsCreds ? "You'll need an API key." : "No credentials needed!"}`);
      setTimeout(() => { showView("home"); openConnectModal(matched); }, 600);
      return;
    }

    // Derive a slug from the first recognisable noun in the prompt
    const slug = (text.match(/\b([a-z][a-z0-9-]{2,})\b/i)?.[1] ?? "custom").toLowerCase().replace(/[^a-z0-9]/g, "");
    const botDiv = addMsg("bot", `Generating <strong>${slug}</strong> connector… (~30 s)`);

    showView("home");
    showPipelineSection();
    resetPipeline();

    try {
      const result = await callTool("conduit__generate_connector", {
        name: slug,
        service_description: text,
      });
      const raw = result?.content?.[0]?.text || "";
      let data;
      try { data = JSON.parse(raw); } catch { data = {}; }

      if (data.registered) {
        botDiv.querySelector(".msg-bubble").innerHTML =
          `<strong>${slug}</strong> is live — ${data.toolCount || "new"} tools added.`;
        loadConnectors();
      } else {
        botDiv.querySelector(".msg-bubble").innerHTML =
          `Generation failed: ${esc(data.error || raw.slice(0, 120))}`;
      }
    } catch (err) {
      botDiv.querySelector(".msg-bubble").innerHTML = `Error: ${esc(err.message)}`;
    }
  }

  // ── Wire up UI ────────────────────────────────────────────
  $("#openChat").addEventListener("click", () => showView("chat"));
  $("#closeChat").addEventListener("click", () => showView("home"));
  $("#modal-close").addEventListener("click", hideModal);
  $("#modal-bg").addEventListener("click", (e) => { if (e.target === $("#modal-bg")) hideModal(); });

  const chatInput = $("#chat-input");
  const chatSend = $("#chat-send");

  function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = "";
    chatInput.style.height = "auto";
    handleChat(text);
  }

  chatSend.addEventListener("click", sendChat);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  });

  // ── Bootstrap ─────────────────────────────────────────────
  async function init() {
    showView("home");
    connectWS();
    await loadCatalog();
    await loadConnectors();
    initMCP().catch(() => {}); // warm the session; ignore failure (key may not be set)
  }

  init();
})();
