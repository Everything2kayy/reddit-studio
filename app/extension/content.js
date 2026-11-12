// Reddit Studio extension: a Studio panel on reddit.com, plus the bridge that lets the
// Reddit Studio app read through this signed-in tab. Read-only: it never posts, votes,
// comments or messages.
(() => {
  // After the extension is reloaded or updated, copies already running in open tabs lose their link to Chrome
  // ("extension context invalidated"). Detect that, shut this copy down quietly, and let the new copy take over.
  const ME = {};                                   // the newest copy in a tab wins; older ones step aside
  const alive = () => { try { return window.__redditStudio === ME && !!(chrome.runtime && chrome.runtime.id); } catch { return false; } };
  window.__redditStudio = ME;
  if (!alive()) return;
  const old = document.getElementById("reddit-studio-host"); if (old) old.remove();   // a previous copy's panel
  document.getElementById("reddit-studio-tweaks")?.remove();
  const VERSION = chrome.runtime.getManifest().version;
  let dead = false;
  function shutdown() {
    if (dead) return; dead = true;
    try { document.getElementById("reddit-studio-host")?.remove(); } catch {}
  }
  const store = {
    get(key, cb) { if (!alive()) return shutdown(); try { chrome.storage.local.get(key, (v) => { if (alive()) cb(v || {}); else shutdown(); }); } catch { shutdown(); } },
    set(obj) { if (!alive()) return shutdown(); try { chrome.storage.local.set(obj); } catch { shutdown(); } },
  };

  // ---------------- storage ----------------
  const S = { open: false, tab: "reader", tweaks: {}, css: "", bridge: true, keywords: "" };
  const save = () => store.set({ rs: S });
  const log = [];
  const note = (t) => { log.push(`${new Date().toLocaleTimeString()}  ${t}`); if (log.length > 200) log.shift(); if (S.tab === "dev") renderDev(); };

  // ---------------- reddit data (same-origin, your own session) ----------------
  const cache = new Map();
  async function rj(path, params = {}) {
    const clean = path.split("?")[0].replace(/\/+$/, "") || "";
    const q = new URLSearchParams({ raw_json: "1", ...params });
    const url = `${location.origin}${clean === "" ? "/" : clean}.json?${q}`;
    const hit = cache.get(url);
    if (hit && Date.now() - hit.t < 120000) return hit.d;
    const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    if (!r.ok) throw Object.assign(new Error(`Reddit returned ${r.status}`), { status: r.status });
    const d = await r.json();
    cache.set(url, { t: Date.now(), d });
    return d;
  }
  const kids = (l) => (l && l.data && l.data.children) || [];
  const pagePath = () => location.pathname.replace(/\/+$/, "") || "/";
  const isThread = () => /\/comments\/[a-z0-9]+/i.test(location.pathname);
  const ago = (s) => { const m = (Date.now() / 1000 - s) / 60; return m < 60 ? `${m | 0}m` : m < 1440 ? `${(m / 60) | 0}h` : `${(m / 1440) | 0}d`; };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n ?? 0));

  // ---------------- bridge to the Reddit Studio app ----------------
  let bridgeOn = false, bridgeErr = "";
  const send = (msg) => new Promise((res) => {
    if (!alive()) { shutdown(); return res({ ok: false, error: "extension was updated; reload this tab", dead: true }); }
    try { chrome.runtime.sendMessage(msg, (r) => res(r || { ok: false, error: chrome.runtime.lastError?.message })); }
    catch (e) { if (!alive()) shutdown(); res({ ok: false, error: String(e), dead: !alive() }); }
  });
  async function bridgeLoop() {
    const first = await send({ type: "status" });
    bridgeOn = !!(first.ok && S.bridge); paintStatus();
    for (;;) {
      if (dead || !alive()) { shutdown(); return; }
      if (!S.bridge) { bridgeOn = false; await sleep(3000); continue; }
      const r = await send({ type: "checkin", body: { version: VERSION, tab: location.pathname, recent: visits } });
      const was = bridgeOn;
      bridgeOn = !!r.ok; bridgeErr = r.ok ? "" : r.error || "";
      if (was !== bridgeOn) { paintStatus(); note(bridgeOn ? "Connected to the Reddit Studio app" : "App not reachable"); }
      if (!r.ok) { await sleep(5000); continue; }
      for (const job of r.result.jobs || []) handleJob(job);
    }
  }
  async function handleJob(job) {
    if (!/^\/[A-Za-z0-9_\/\-.]*(\?.*)?$/.test(job.url)) return send({ type: "result", id: job.id, body: { error: "unsafe path" } });
    try {
      const r = await fetch(location.origin.replace("old.", "www.") + job.url, { credentials: "include", headers: { Accept: "application/json" } });
      if (!r.ok) {
        let reason = "";
        try { const t = await r.text(); const j = JSON.parse(t); reason = j.reason || j.message || ""; } catch {}
        if (r.status === 403 && !reason && /over18|nsfw/i.test(r.url)) reason = "18+ content is off for this account";
        note(`App asked for ${job.url.split("?")[0]} → ${r.status}${reason ? " (" + reason + ")" : ""}`);
        return send({ type: "result", id: job.id, body: { error: "http", status: r.status, reason } });
      }
      if (/\/over18/.test(r.url)) {
        note(`App asked for ${job.url.split("?")[0]} → 18+ content is off for this account`);
        return send({ type: "result", id: job.id, body: { error: "http", status: 403, reason: "18+ content is off for this account" } });
      }
      const data = await r.json();
      note(`App asked for ${job.url.split("?")[0]} → ok`);
      send({ type: "result", id: job.id, body: { data } });
    } catch (e) { note(`App request failed: ${e.message}`); send({ type: "result", id: job.id, body: { error: String(e.message) } }); }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // recent visits on reddit.com (communities, users, posts), so the app can show them under Recent
  let visits = [];
  store.get("rs_visits", ({ rs_visits }) => { visits = rs_visits || []; recordVisit(); });
  function recordVisit() {
    const p = location.pathname;
    let m, item = null;
    if ((m = /^\/r\/([A-Za-z0-9_]+)\/comments\/([a-z0-9]+)/i.exec(p))) item = { t: "post", id: m[2], sub: m[1], title: document.title.replace(/ : r\/.*$| - Reddit$/i, "").slice(0, 140) };
    else if ((m = /^\/r\/([A-Za-z0-9_+]+)\/?/i.exec(p))) item = { t: "r", name: m[1] };
    else if ((m = /^\/(?:u|user)\/([A-Za-z0-9_\-]+)\/?(?:$|submitted|overview)/i.exec(p))) item = { t: "u", name: m[1] };
    else if ((m = /^\/user\/([A-Za-z0-9_\-]+)\/m\/([A-Za-z0-9_]+)/i.exec(p))) item = { t: "m", user: m[1], name: m[2] };
    if (!item) return;
    const key = JSON.stringify([item.t, item.id || item.name, item.user || ""]);
    visits = [{ ...item, at: Date.now() }, ...visits.filter((v) => JSON.stringify([v.t, v.id || v.name, v.user || ""]) !== key)].slice(0, 100);
    store.set({ rs_visits: visits });
  }

  // ---------------- page tweaks ----------------
  const TWEAKS = [
    ["hide-sidebar", "Hide sidebars", "aside,#right-sidebar-container{display:none!important}"],
    ["hide-promoted", "Hide promoted posts", "shreddit-ad-post,shreddit-post[promoted],[data-promoted=true]{display:none!important}"],
    ["wide", "Full-width content", "main,.main-container,shreddit-app main{max-width:100%!important}"],
    ["hide-avatars", "Hide avatars", "faceplate-img[class*=avatar],shreddit-subreddit-icon{display:none!important}"],
    ["hide-counts", "Hide vote counts", "faceplate-number{visibility:hidden!important}"],
    ["hide-awards", "Hide award buttons", "[aria-label*=award i],award-button{display:none!important}"],
    ["blur-nsfw", "Blur 18+ media", "shreddit-post[nsfw] img,shreddit-post[nsfw] video{filter:blur(22px)!important}"],
    ["compact", "Compact posts", "shreddit-post{padding-block:4px!important;margin-block:2px!important}"],
    ["bigger-text", "Bigger text", "html{font-size:112%!important}"],
    ["serif", "Serif reading font", "shreddit-post,shreddit-comment,.md{font-family:Georgia,serif!important}"],
    ["mono-comments", "Monospace comments", "shreddit-comment{font-family:ui-monospace,Menlo,monospace!important}"],
    ["grayscale", "Grayscale media (color on hover)", "img,video{filter:grayscale(1)}img:hover,video:hover{filter:none}"],
    ["no-motion", "Reduce motion", "*,*::before,*::after{animation:none!important;transition:none!important}"],
    ["underline", "Underline links", "a{text-decoration:underline!important}"],
  ];
  const DEV_TWEAKS = [
    ["dev-outline", "Outline every element", "*{outline:1px solid rgba(255,60,60,.18)!important}"],
    ["dev-shadow", "Highlight web components", "[class*=shreddit],shreddit-post,shreddit-comment,faceplate-tracker{outline:1px dashed #0af!important}"],
  ];
  const pageStyle = document.createElement("style");
  pageStyle.id = "reddit-studio-tweaks";
  function applyTweaks() {
    pageStyle.textContent = [...TWEAKS, ...DEV_TWEAKS].filter(([id]) => S.tweaks[id]).map((t) => t[2]).join("\n") + "\n" + (S.css || "");
    if (!pageStyle.isConnected) document.documentElement.appendChild(pageStyle);
  }

  // ---------------- panel (shadow DOM, so reddit's styles don't leak in) ----------------
  const host = document.createElement("div");
  host.id = "reddit-studio-host";
  host.style.cssText = "all:initial;position:fixed;z-index:2147483646;top:0;right:0;height:0;width:0";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host{--bg:#121417;--bg2:#1b1e23;--line:#2b3038;--fg:#e8eaed;--mut:#9aa0a6;--acc:#ff5700;--ok:#2bb673;--warn:#f5a623}
    *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #fab{position:fixed;right:18px;bottom:18px;width:46px;height:46px;border-radius:50%;border:0;background:var(--acc);color:#fff;font:700 15px/1 -apple-system,sans-serif;cursor:pointer;box-shadow:0 6px 20px #0006}
    #fab i{position:absolute;right:2px;top:2px;width:11px;height:11px;border-radius:50%;background:var(--mut);border:2px solid var(--acc)}
    #fab i.on{background:var(--ok)}
    #panel{position:fixed;top:0;right:0;width:min(440px,100vw);height:100vh;background:var(--bg);color:var(--fg);border-left:1px solid var(--line);display:flex;flex-direction:column;font-size:13.5px;box-shadow:-10px 0 30px #0007}
    #panel[hidden]{display:none}
    header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}
    header b{flex:1;font-size:15px}
    .st{font-size:11.5px;color:var(--mut)} .st.on{color:var(--ok)}
    nav{display:flex;gap:4px;padding:8px 10px;border-bottom:1px solid var(--line)}
    nav button{flex:1}
    button{background:var(--bg2);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:12.5px;cursor:pointer}
    button:hover{border-color:var(--mut)} button.on,button.pri{background:var(--acc);border-color:var(--acc);color:#fff}
    #body{flex:1;overflow:auto;padding:10px 12px}
    .row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0}
    .post{padding:9px 8px;border-bottom:1px solid var(--line);cursor:pointer;border-radius:6px}
    .post:hover{background:var(--bg2)}
    .post .t{font-weight:600;line-height:1.3} .meta{color:var(--mut);font-size:11.5px;margin-top:3px}
    .c{border-left:2px solid var(--line);padding:4px 0 4px 9px;margin:6px 0}
    .c .a{color:var(--mut);font-size:11.5px} .c .b{white-space:pre-wrap;line-height:1.4;margin-top:2px}
    .hl{background:#ff570033;outline:1px solid var(--acc);border-radius:3px}
    h3{font-size:13px;margin:14px 0 6px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
    .bar{display:flex;align-items:center;gap:6px;font-size:12px;margin:3px 0} .bar span:first-child{width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bar i{display:block;height:8px;background:var(--acc);border-radius:4px}
    pre,textarea{width:100%;background:#0b0c0e;color:#cfe3ff;border:1px solid var(--line);border-radius:8px;padding:8px;font:11.5px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
    pre{max-height:340px;overflow:auto} textarea{min-height:120px}
    input[type=text]{width:100%;flex:1;min-width:0;background:var(--bg2);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:7px 9px}
    label.tw{display:flex;gap:8px;align-items:center;padding:4px 0;cursor:pointer}
    .err{color:#ff6b6b} .mut{color:var(--mut)}
  </style>
  <button id="fab" title="Reddit Studio (Alt+S)">RS<i id="dot"></i></button>
  <div id="panel" hidden>
    <header><b>Reddit Studio</b><span class="st" id="st"></span><button id="x" title="Close">✕</button></header>
    <nav><button data-tab="reader">Reader</button><button data-tab="tools">Tools</button><button data-tab="tweaks">Tweaks</button><button data-tab="dev">Dev</button></nav>
    <div id="body"></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const body = () => $("#body");

  function paintStatus() {
    $("#dot").classList.toggle("on", bridgeOn);
    const st = $("#st");
    st.className = "st" + (bridgeOn ? " on" : "");
    st.textContent = !S.bridge ? "App link off" : bridgeOn ? "● Linked to app" : "App not running";
    st.title = bridgeOn ? "The Reddit Studio app can read through this tab." : bridgeErr;
  }
  function setOpen(v) { S.open = v; $("#panel").hidden = !v; $("#fab").hidden = v; save(); if (v) render(); }
  function setTab(t) { S.tab = t; save(); render(); }

  // ---------------- Reader ----------------
  let reader = { path: null, view: "list", posts: [], after: null, thread: null };
  async function renderReader() {
    const b = body();
    if (reader.view === "thread" && reader.thread) return renderThread();
    const path = isThread() ? pagePath().replace(/\/comments\/.*/, "") || "/" : pagePath();
    b.innerHTML = `<div class="row" style="flex-wrap:nowrap"><input type="text" id="go" placeholder="r/subreddit, u/user, or a reddit link" value="${esc(reader.path || path)}"><button class="pri" id="gob">Go</button></div><div id="list" class="mut">Loading…</div>`;
    const go = async (p) => {
      p = p.trim().replace(/^https?:\/\/[^/]+/, "");
      if (/^r\/|^u\//.test(p)) p = "/" + p.replace(/^u\//, "user/");
      if (!p.startsWith("/")) p = "/r/" + p;
      reader.path = p;
      if (/\/comments\//.test(p)) return openThread(p);
      try {
        const d = await rj(p, { limit: 50 });
        reader.posts = kids(d).filter((k) => k.kind === "t3").map((k) => k.data);
        reader.after = d.data && d.data.after;
        drawList();
      } catch (e) { $("#list").innerHTML = `<span class="err">${esc(e.message)}</span>`; }
    };
    $("#gob").onclick = () => go($("#go").value);
    $("#go").onkeydown = (e) => e.key === "Enter" && go($("#go").value);
    if (isThread() && !reader.path) return openThread(pagePath());
    go(reader.path || path);
  }
  function drawList() {
    const kw = S.keywords.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    $("#list").innerHTML = reader.posts.map((p, i) => {
      const hit = kw.some((k) => (p.title + " " + p.selftext).toLowerCase().includes(k));
      return `<div class="post${hit ? " hl" : ""}" data-i="${i}"><div class="t">${esc(p.title)}</div>
        <div class="meta">r/${esc(p.subreddit)} · u/${esc(p.author)} · ${ago(p.created_utc)} · ▲ ${num(p.score)} · 💬 ${num(p.num_comments)}${p.over_18 ? " · 18+" : ""}</div></div>`;
    }).join("") || `<span class="mut">No posts here.</span>`;
    root.querySelectorAll(".post").forEach((el) => el.onclick = () => openThread(reader.posts[+el.dataset.i].permalink));
  }
  async function openThread(permalink) {
    reader.view = "thread"; reader.thread = { permalink, data: null };
    body().innerHTML = `<span class="mut">Loading thread…</span>`;
    try { reader.thread.data = await rj(permalink, { limit: 300, sort: "top" }); renderThread(); }
    catch (e) { body().innerHTML = `<button id="back">← Back</button><p class="err">${esc(e.message)}</p>`; $("#back").onclick = back; }
  }
  const back = () => { reader.view = "list"; reader.thread = null; renderReader(); };
  function renderThread() {
    const [pl, cl] = reader.thread.data, p = kids(pl)[0].data;
    const walk = (list, depth) => kids(list).filter((k) => k.kind === "t1").map((k) => {
      const c = k.data;
      return `<div class="c" style="margin-left:${Math.min(depth, 6) * 6}px"><div class="a">u/${esc(c.author)} · ▲ ${num(c.score)} · ${ago(c.created_utc)}</div><div class="b">${esc(c.body)}</div>${c.replies ? walk(c.replies, depth + 1) : ""}</div>`;
    }).join("");
    body().innerHTML = `<div class="row"><button id="back">← Back</button><button id="openp">Open on Reddit</button></div>
      <div class="t" style="font-size:15px;font-weight:700;margin:8px 0 4px">${esc(p.title)}</div>
      <div class="meta">r/${esc(p.subreddit)} · u/${esc(p.author)} · ▲ ${num(p.score)} · 💬 ${num(p.num_comments)}</div>
      ${p.selftext ? `<div class="c"><div class="b">${esc(p.selftext)}</div></div>` : ""}
      ${p.url && !p.is_self ? `<p><a style="color:var(--acc)" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></p>` : ""}
      <h3>Comments</h3>${walk(cl, 0) || '<span class="mut">No comments yet.</span>'}`;
    $("#back").onclick = back;
    $("#openp").onclick = () => (location.href = p.permalink);
  }

  // ---------------- Tools ----------------
  async function currentPosts() {
    if (isThread()) return [];
    return kids(await rj(pagePath(), { limit: 100 })).filter((k) => k.kind === "t3").map((k) => k.data);
  }
  function bars(title, counts, limit = 8) {
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return `<h3>${title}</h3>` + (rows.map(([k, v]) => `<div class="bar"><span title="${esc(k)}">${esc(k)}</span><i style="width:${(v / max) * 200}px"></i><span>${v}</span></div>`).join("") || '<span class="mut">—</span>');
  }
  const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); if (k != null) m[k] = (m[k] || 0) + 1; return m; }, {});
  function download(name, text, type = "text/plain") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function renderTools() {
    const b = body();
    b.innerHTML = `<div class="row">
        <button id="t-stats">Page stats</button><button id="t-media">Media links</button>
        <button id="t-md">Export thread (Markdown)</button><button id="t-json">Export JSON</button><button id="t-csv">Export posts (CSV)</button></div>
      <h3>Keyword highlight</h3><div class="row"><input type="text" id="kw" placeholder="comma, separated, words" value="${esc(S.keywords)}"></div>
      <div id="out"></div>`;
    $("#kw").onchange = () => { S.keywords = $("#kw").value; save(); };
    const out = (h) => ($("#out").innerHTML = h);
    $("#t-stats").onclick = async () => {
      out('<span class="mut">Working…</span>');
      try {
        const ps = await currentPosts();
        if (!ps.length) return out('<span class="mut">Open a community or feed page first.</span>');
        const type = (p) => p.is_video ? "video" : p.post_hint === "image" || /\.(jpe?g|png|gif|webp)$/i.test(p.url) ? "image" : p.is_gallery ? "gallery" : p.is_self ? "text" : "link";
        const avg = (k) => Math.round(ps.reduce((s, p) => s + (p[k] || 0), 0) / ps.length);
        out(`<p>${ps.length} posts · avg ▲ ${num(avg("score"))} · avg 💬 ${num(avg("num_comments"))}</p>` +
          bars("Post types", count(ps, type)) + bars("Top domains", count(ps, (p) => p.is_self ? null : p.domain)) +
          bars("Top posters", count(ps, (p) => "u/" + p.author)) +
          bars("Posting hour (your time)", count(ps, (p) => String(new Date(p.created_utc * 1000).getHours()).padStart(2, "0") + ":00"), 24) +
          bars("Flairs", count(ps, (p) => p.link_flair_text || null)));
      } catch (e) { out(`<span class="err">${esc(e.message)}</span>`); }
    };
    $("#t-media").onclick = async () => {
      try {
        const ps = isThread() ? [kids((await rj(pagePath()))[0])[0].data] : await currentPosts();
        const links = [];
        for (const p of ps) {
          if (p.is_video && p.media?.reddit_video) links.push(p.media.reddit_video.fallback_url);
          else if (p.is_gallery && p.media_metadata) Object.values(p.media_metadata).forEach((m) => m.s && links.push(m.s.u || m.s.gif));
          else if (/\.(jpe?g|png|gif|webp|mp4)$/i.test(p.url || "")) links.push(p.url);
        }
        out(links.length ? `<p>${links.length} media links</p><pre>${esc(links.join("\n"))}</pre><button id="cp">Copy all</button>` : '<span class="mut">No media found on this page.</span>');
        if (links.length) $("#cp").onclick = () => navigator.clipboard.writeText(links.join("\n"));
      } catch (e) { out(`<span class="err">${esc(e.message)}</span>`); }
    };
    $("#t-md").onclick = async () => {
      if (!isThread()) return out('<span class="mut">Open a post first.</span>');
      const [pl, cl] = await rj(pagePath(), { limit: 500 }); const p = kids(pl)[0].data;
      const walk = (l, d) => kids(l).filter((k) => k.kind === "t1").map((k) => `${"  ".repeat(d)}- **u/${k.data.author}** (${k.data.score}): ${k.data.body.replace(/\n+/g, " ")}\n${k.data.replies ? walk(k.data.replies, d + 1) : ""}`).join("");
      download(`${p.id}.md`, `# ${p.title}\n\nr/${p.subreddit} · u/${p.author} · ${p.score} points\n\n${p.selftext || p.url}\n\n## Comments\n\n${walk(cl, 0)}`, "text/markdown");
    };
    $("#t-json").onclick = async () => download(`reddit${pagePath().replace(/\W+/g, "-")}.json`, JSON.stringify(await rj(pagePath(), { limit: 100 }), null, 2), "application/json");
    $("#t-csv").onclick = async () => {
      const ps = await currentPosts(); if (!ps.length) return out('<span class="mut">Open a community or feed page first.</span>');
      const cols = ["id", "subreddit", "author", "title", "score", "num_comments", "created_utc", "url", "permalink"];
      const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      download("posts.csv", [cols.join(","), ...ps.map((p) => cols.map((c) => q(p[c])).join(","))].join("\n"), "text/csv");
    };
  }

  // ---------------- Tweaks ----------------
  function renderTweaks() {
    body().innerHTML = `<h3>Page tweaks</h3>` + TWEAKS.map(([id, label]) => `<label class="tw"><input type="checkbox" data-tw="${id}" ${S.tweaks[id] ? "checked" : ""}>${esc(label)}</label>`).join("") +
      `<h3>Your CSS</h3><textarea id="css" spellcheck="false" placeholder="/* applied to reddit.com live */">${esc(S.css)}</textarea><p class="mut">Changes apply as you type and are saved.</p>`;
    root.querySelectorAll("[data-tw]").forEach((c) => c.onchange = () => { S.tweaks[c.dataset.tw] = c.checked; save(); applyTweaks(); });
    $("#css").oninput = () => { S.css = $("#css").value; save(); applyTweaks(); };
  }

  // ---------------- Dev ----------------
  let picking = false, pickBox = null;
  function selectorFor(el) {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 5) {
      let s = el.localName;
      if (el.id) { parts.unshift(`${s}#${CSS.escape(el.id)}`); break; }
      const attr = ["data-testid", "slot", "name", "aria-label"].find((a) => el.getAttribute(a));
      if (attr) s += `[${attr}="${el.getAttribute(attr).slice(0, 40)}"]`;
      else if (el.classList.length) s += "." + [...el.classList].slice(0, 2).map((c) => CSS.escape(c)).join(".");
      parts.unshift(s); el = el.parentElement;
    }
    return parts.join(" > ");
  }
  function startPick() {
    picking = true; setOpen(false);
    pickBox = Object.assign(document.createElement("div"), { style: "position:fixed;pointer-events:none;z-index:2147483645;border:2px solid #ff5700;background:#ff570022;border-radius:3px" });
    document.documentElement.appendChild(pickBox);
    const move = (e) => { const r = e.target.getBoundingClientRect(); Object.assign(pickBox.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" }); };
    const click = (e) => {
      e.preventDefault(); e.stopPropagation();
      const sel = selectorFor(e.target);
      navigator.clipboard.writeText(sel).catch(() => {});
      note(`Picked: ${sel}`);
      document.removeEventListener("mousemove", move, true); document.removeEventListener("click", click, true);
      pickBox.remove(); picking = false; S.tab = "dev"; setOpen(true);
      $("#pick-out").textContent = `${sel}\n\n(copied to clipboard)`;
    };
    document.addEventListener("mousemove", move, true); document.addEventListener("click", click, true);
  }
  function renderDev() {
    if (S.tab !== "dev" || !S.open) return;
    const b = body(), keepScroll = b.scrollTop;
    if (!$("#dev-root")) {
      b.innerHTML = `<div id="dev-root">
        <div class="row"><button id="d-json">Inspect page JSON</button><button id="d-raw">Open .json</button><button id="d-old">Open on old.reddit</button><button id="d-pick">Pick element → selector</button></div>
        <h3>Dev overlays</h3>${DEV_TWEAKS.map(([id, l]) => `<label class="tw"><input type="checkbox" data-tw="${id}" ${S.tweaks[id] ? "checked" : ""}>${esc(l)}</label>`).join("")}
        <h3>Picked selector</h3><pre id="pick-out" class="mut">Nothing picked yet.</pre>
        <h3>JSON</h3><div class="row"><input type="text" id="jq" placeholder="filter, e.g. data.children.0.data.title"></div><pre id="json-out" class="mut">Click “Inspect page JSON”.</pre>
        <h3>App link</h3><label class="tw"><input type="checkbox" id="d-bridge" ${S.bridge ? "checked" : ""}>Let the Reddit Studio app read through this tab</label>
        <pre id="d-log"></pre></div>`;
      let lastJson = null;
      const showJson = () => {
        if (!lastJson) return;
        let v = lastJson;
        for (const k of $("#jq").value.split(".").filter(Boolean)) v = v == null ? v : v[k];
        $("#json-out").textContent = JSON.stringify(v, null, 2)?.slice(0, 200000) ?? "undefined";
      };
      $("#d-json").onclick = async () => { try { lastJson = await rj(pagePath(), { limit: 25 }); showJson(); } catch (e) { $("#json-out").textContent = e.message; } };
      $("#jq").oninput = showJson;
      $("#d-raw").onclick = () => window.open(`${location.origin}${pagePath()}.json?raw_json=1`, "_blank");
      $("#d-old").onclick = () => (location.href = location.href.replace("://www.", "://old."));
      $("#d-pick").onclick = startPick;
      root.querySelectorAll("#dev-root [data-tw]").forEach((c) => c.onchange = () => { S.tweaks[c.dataset.tw] = c.checked; save(); applyTweaks(); });
      $("#d-bridge").onchange = () => { S.bridge = $("#d-bridge").checked; save(); paintStatus(); };
    }
    $("#d-log").textContent = `Extension ${VERSION} · ${bridgeOn ? "linked to app" : "app not linked"}\n` + (log.slice(-40).join("\n") || "No activity yet.");
    b.scrollTop = keepScroll;
  }

  function render() {
    root.querySelectorAll("nav button").forEach((x) => x.classList.toggle("on", x.dataset.tab === S.tab));
    paintStatus();
    if (S.tab === "reader") renderReader();
    else if (S.tab === "tools") renderTools();
    else if (S.tab === "tweaks") renderTweaks();
    else { body().innerHTML = ""; renderDev(); }
  }

  // ---------------- wiring ----------------
  $("#fab").onclick = () => setOpen(true);
  $("#x").onclick = () => setOpen(false);
  root.querySelectorAll("nav button").forEach((x) => (x.onclick = () => setTab(x.dataset.tab)));
  document.addEventListener("keydown", (e) => { if (e.altKey && (e.key === "s" || e.code === "KeyS")) { e.preventDefault(); setOpen(!S.open); } });
  try { chrome.runtime.onMessage.addListener((m) => { if (m.type === "toggle") setOpen(!S.open); }); } catch {}
  let lastPath = location.pathname;
  setInterval(() => { if (location.pathname !== lastPath) { lastPath = location.pathname; setTimeout(recordVisit, 1200); reader = { path: null, view: "list" }; if (S.open && S.tab === "reader") render(); } }, 800);

  store.get("rs", ({ rs }) => {
    Object.assign(S, rs || {});
    document.documentElement.appendChild(host);
    applyTweaks();
    if (S.open) setOpen(true); else paintStatus();
    bridgeLoop();
  });
})();
