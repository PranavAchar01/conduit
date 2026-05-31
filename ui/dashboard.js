// Dashboard client. Connects to the sidecar WS on the same host:port that
// served this page. Renders connector list, pipeline stages, and the live count.
(() => {
  const $ = (sel) => document.querySelector(sel);
  const countEl = $("#toolCount");
  const connectorsEl = $("#connectors");
  const logEl = $("#log");
  const footEl = $("#conn");
  const seenConnectors = new Set();

  function setCount(n) {
    if (String(n) === countEl.textContent) return;
    countEl.textContent = n;
    countEl.classList.add("bump");
    setTimeout(() => countEl.classList.remove("bump"), 250);
  }

  function addConnector(name, toolCount) {
    if (seenConnectors.has(name)) return;
    seenConnectors.add(name);
    const li = document.createElement("li");
    li.innerHTML = `<span>${name}</span><span class="badge">${toolCount} tools</span>`;
    connectorsEl.appendChild(li);
  }

  function stage(name, status, detail) {
    const li = document.querySelector(`.pipeline li[data-stage="${name}"]`);
    if (!li) return;
    li.classList.add("active");
    li.setAttribute("data-status", status);
    if (detail) li.querySelector(".detail").textContent = detail;
  }

  function log(text) {
    const cls = /critical|high/i.test(text) ? "critical" : /pass|ok|live/i.test(text) ? "ok" : "";
    const line = document.createElement("span");
    line.className = cls;
    line.textContent = text + "\n";
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function handle(ev) {
    switch (ev.type) {
      case "tool_count": setCount(ev.count); break;
      case "connector_added": addConnector(ev.name, ev.toolCount); break;
      case "connector_failed": log(`connector ${ev.name} failed: ${ev.error}`); break;
      case "pipeline": stage(ev.stage, ev.status, ev.detail); break;
      case "log": log(ev.text); break;
    }
  }

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}`);
    ws.onopen = () => { footEl.textContent = "connected"; footEl.className = "connected"; };
    ws.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch {} };
    ws.onclose = () => {
      footEl.textContent = "disconnected — retrying…";
      footEl.className = "disconnected";
      setTimeout(connect, 1000); // resilience: auto-reconnect during the demo
    };
  }
  connect();
})();
