// Talks to the Reddit Studio app on this Mac (http://127.0.0.1:5055).
// The page itself can't reach localhost, so the panel asks this worker to do it.
const APP = "http://127.0.0.1:5055";
const H = { "X-Reddit-Studio": "1", "Content-Type": "application/json" };

async function call(path, body) {
  const r = await fetch(APP + path, { method: body === undefined ? "GET" : "POST", headers: H,
    body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "App error");
  return j.result;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    try {
      if (msg.type === "checkin") return reply({ ok: true, result: await call("/api/bridge/checkin", msg.body) });
      if (msg.type === "result") return reply({ ok: true, result: await call(`/api/bridge/result/${msg.id}`, msg.body) });
      if (msg.type === "status") return reply({ ok: true, result: await call("/api/status") });
      reply({ ok: false, error: "unknown" });
    } catch (e) { reply({ ok: false, error: String(e.message || e) }); }
  })();
  return true;
});

// Toolbar button toggles the panel on the current reddit tab.
chrome.action.onClicked.addListener(tab => {
  if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "toggle" }).catch(() => {});
});
