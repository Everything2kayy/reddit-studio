/* Reddit Studio: layout + My Reddit.
   Layout: drag the dividers to resize the sidebar, feed and post panes; or switch to Tabs and show one pane at a time
   (My Reddit / Feed / Post), full width. "Side by side" returns to normal. \ cycles layouts; Alt+1/2/3 pick a tab.
   My Reddit: your Reddit account's joined communities and custom feeds (via your sign-in or the Chrome extension),
   your Studio custom feeds and favorites, and where you've been recently (in the app and on reddit.com). */
(function () {
  "use strict";
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
               set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const e = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const desktop = matchMedia("(min-width: 861px)");
  const L = Object.assign({ mode: "split", tab: "feed", sb: false, sbW: 270, feedW: 440, feedWide: 0 }, LS.get("rs_layout2", {}));
  const save = () => LS.set("rs_layout2", L);

  const css = document.createElement("style");
  css.textContent = `
  #cols{position:relative}
  #mysb{overflow:auto;border-right:1px solid var(--border);background:var(--panel);min-width:0;display:none}
  .sb-on #mysb{display:block}
  .splitter{position:absolute;top:0;bottom:0;width:8px;margin-left:-4px;cursor:col-resize;z-index:6}
  .splitter::after{content:"";position:absolute;left:3px;top:0;bottom:0;width:2px;background:transparent;transition:background .15s}
  .splitter:hover::after,.splitter.drag::after{background:var(--accent)}
  .lay-tabs .splitter,.no-desk .splitter{display:none}
  #laybar{display:flex;gap:4px;align-items:center}
  #laybar .seg button{padding:5px 8px}
  #tabbar{display:none;gap:4px;padding:6px 14px;border-bottom:1px solid var(--border);background:var(--panel)}
  .lay-tabs #tabbar{display:flex}
  #tabbar button{border-radius:8px}#tabbar button.on{background:var(--accent);color:var(--bg);border-color:transparent;font-weight:600}
  #tabbar .sp{flex:1}
  html.lay-tabs .cols,html.lay-tabs .cols.wide{grid-template-columns:1fr!important}
  html.lay-tabs #cols>#mysb,html.lay-tabs #cols>#feedwrap,html.lay-tabs #cols>#detail{display:none!important}
  html.lay-tabs.tab-my #cols>#mysb,html.lay-tabs.tab-feed #cols>#feedwrap,html.lay-tabs.tab-post #cols>#detail{display:block!important;border-right:0}
  /* My Reddit */
  .mysb-head{display:flex;align-items:center;gap:6px;padding:10px 12px;position:sticky;top:0;background:var(--panel);z-index:2;border-bottom:1px solid var(--border)}
  .mysb-head b{flex:1}
  .mysb-head input{width:100%;margin-top:6px}
  #mysb details{border-bottom:1px solid var(--border)}
  #mysb summary{padding:9px 12px;cursor:pointer;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700;list-style:none;display:flex;gap:6px}
  #mysb summary::after{content:"▾";margin-left:auto}#mysb details:not([open]) summary::after{content:"▸"}
  #mysb summary small{font-weight:500;text-transform:none;letter-spacing:0}
  .mi{display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:13.5px;min-width:0}
  .mi:hover{background:var(--panel2)}.mi.on{background:color-mix(in srgb,var(--accent) 16%,transparent)}
  .mi img,.mi .ic{width:22px;height:22px;border-radius:50%;flex:none;object-fit:cover;background:var(--panel2);display:grid;place-items:center;font-size:12px}
  .mi .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mi small{color:var(--muted);font-size:11px;flex:none}
  .mi .act{opacity:0;border:0;background:transparent;padding:0 4px}.mi:hover .act{opacity:1}
  .mynote{padding:10px 12px;font-size:12.5px;color:var(--muted)}
  .hint18{margin-top:10px;font-size:12.5px;color:var(--text);background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:8px 10px;text-align:left}`;
  document.head.appendChild(css);

  /* ---------------- build the pieces ---------------- */
  const cols = $("#cols"), feedwrap = $("#feedwrap"), detail = $("#detail");
  const sb = document.createElement("aside"); sb.id = "mysb"; cols.insertBefore(sb, cols.firstChild);
  const sp1 = document.createElement("div"); sp1.className = "splitter"; sp1.title = "Drag to resize (double-click resets)";
  const sp2 = sp1.cloneNode(); cols.append(sp1, sp2);
  const rbar = $(".rbar");
  rbar.insertAdjacentHTML("beforeend", `<div id="laybar">
    <button id="sbbtn" class="ghost" title="My Reddit sidebar (Alt+1 in Tabs)"><span class="ms" data-fb="My">menu</span></button>
    <div class="seg" title="Layout (\\ cycles)">
      <button data-lay="split" title="Side by side (normal)"><span class="ms" data-fb="Split">view_column</span></button>
      <button data-lay="tabs" title="Tabs: one pane at a time"><span class="ms" data-fb="Tabs">tab</span></button>
      <button data-lay="feed" title="Feed full width"><span class="ms" data-fb="Feed">view_agenda</span></button>
      <button data-lay="post" title="Post full width"><span class="ms" data-fb="Post">article</span></button></div></div>`);
  rbar.insertAdjacentHTML("afterend", `<div id="tabbar" role="tablist">
    <button data-tab="my">☰ My Reddit</button><button data-tab="feed">Feed</button><button data-tab="post">Post</button>
    <span class="sp"></span><button data-lay="split">▥ Back to side by side</button></div>`);

  /* ---------------- apply layout ---------------- */
  function apply() {
    const de = document.documentElement, cl = de.classList;
    cl.toggle("no-desk", !desktop.matches);
    cl.toggle("lay-tabs", L.mode === "tabs" && desktop.matches);
    ["my", "feed", "post"].forEach(t => cl.toggle("tab-" + t, L.tab === t));
    cl.toggle("sb-on", (L.sb || (L.mode === "tabs" && L.tab === "my")) && desktop.matches);
    $$("#laybar [data-lay]").forEach(b => b.classList.toggle("on", L.mode === "split" ? b.dataset.lay === "split" : (b.dataset.lay === "tabs" || b.dataset.lay === L.tab)));
    $("#sbbtn").classList.toggle("on", !!L.sb);
    $$("#tabbar [data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === L.tab));
    if (!desktop.matches || L.mode === "tabs") { cols.style.gridTemplateColumns = ""; return; }
    const wide = cols.classList.contains("wide");
    const W = cols.clientWidth || innerWidth;
    let fw = wide ? (L.feedWide || Math.round((W - (L.sb ? L.sbW : 0)) * 0.48)) : L.feedW;
    fw = Math.max(260, Math.min(fw, W - (L.sb ? L.sbW : 0) - 300));
    cols.style.gridTemplateColumns = (L.sb ? L.sbW + "px " : "") + fw + "px minmax(0,1fr)";
    sp1.style.display = L.sb ? "" : "none"; sp1.style.left = L.sbW + "px";
    sp2.style.left = (L.sb ? L.sbW : 0) + fw + "px";
    if (L.sb && !sb.dataset.loaded) loadMy();
  }
  function setMode(m) {
    if (m === "feed" || m === "post") { L.mode = "tabs"; L.tab = m; }
    else { L.mode = m; if (m === "tabs" && !["my", "feed", "post"].includes(L.tab)) L.tab = "feed"; }
    if (L.mode === "tabs" && L.tab === "my" && !sb.dataset.loaded) loadMy();
    save(); apply();
  }
  function setTab(t) { L.tab = t; if (t === "my" && !sb.dataset.loaded) loadMy(); save(); apply(); }
  $("#laybar").onclick = ev => { const b = ev.target.closest("[data-lay]"); if (b) setMode(b.dataset.lay); if (ev.target.closest("#sbbtn")) { if (L.mode === "tabs") setTab("my"); else { L.sb = !L.sb; save(); apply(); } } };
  $("#tabbar").onclick = ev => { const b = ev.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); const l = ev.target.closest("[data-lay]"); if (l) setMode(l.dataset.lay); };

  /* drag to resize */
  function drag(which) {
    return ev => {
      ev.preventDefault();
      const el = which === 1 ? sp1 : sp2; el.classList.add("drag");
      const left = cols.getBoundingClientRect().left;
      const move = m => {
        const x = m.clientX - left;
        if (which === 1) L.sbW = Math.max(180, Math.min(480, Math.round(x)));
        else { const v = Math.round(x - (L.sb ? L.sbW : 0)); if (cols.classList.contains("wide")) L.feedWide = v; else L.feedW = v; }
        apply();
      };
      const up = () => { el.classList.remove("drag"); save(); removeEventListener("pointermove", move); removeEventListener("pointerup", up); document.body.style.userSelect = ""; };
      document.body.style.userSelect = "none";
      addEventListener("pointermove", move); addEventListener("pointerup", up);
    };
  }
  sp1.addEventListener("pointerdown", drag(1)); sp2.addEventListener("pointerdown", drag(2));
  sp1.ondblclick = () => { L.sbW = 270; save(); apply(); };
  sp2.ondblclick = () => { if (cols.classList.contains("wide")) L.feedWide = 0; else L.feedW = 440; save(); apply(); };
  new MutationObserver(apply).observe(cols, { attributes: true, attributeFilter: ["class"] });
  addEventListener("resize", apply);
  desktop.addEventListener && desktop.addEventListener("change", apply);

  /* opening a post in Tabs shows the Post tab; Esc goes back to the feed */
  document.addEventListener("rs:post", () => { if (L.mode === "tabs" && desktop.matches) setTab("post"); });
  document.addEventListener("keydown", ev => {
    if (ev.target.closest && ev.target.closest("input,textarea,select,.plyr,.pswp,#rv")) return;
    if (ev.key === "\\" && !ev.metaKey && !ev.ctrlKey) { const order = ["split", "tabs", "feed", "post"]; const cur = L.mode === "split" ? "split" : L.tab === "feed" ? "feed" : L.tab === "post" ? "post" : "tabs"; setMode(order[(order.indexOf(cur) + 1) % order.length]); toast("Layout: " + ({ split: "side by side", tabs: "tabs", feed: "feed full width", post: "post full width" })[L.mode === "split" ? "split" : L.tab === "my" ? "tabs" : L.tab]); }
    if (ev.altKey && ["1", "2", "3"].includes(ev.key)) { ev.preventDefault(); if (L.mode !== "tabs") L.mode = "tabs"; setTab(["my", "feed", "post"][+ev.key - 1]); }
    if (ev.key === "Escape" && L.mode === "tabs" && L.tab === "post" && !document.querySelector(".modalbg:not([hidden])")) setTab("feed");
  });

  /* ---------------- My Reddit ---------------- */
  let my = null, q = "";
  async function loadMy(fresh) {
    sb.dataset.loaded = "1";
    draw("loading");
    try { my = await getJSON("/api/my" + (fresh ? "?fresh=1" : "")); } catch (err) { my = { subs: [], multis: [], recent: [], errors: [err.message] }; }
    syncMultis(); draw();
  }
  function syncMultis() {
    // your Reddit custom feeds become Studio custom feeds (chips, palette, #/f/<name>); yours with the same name win
    if (!my || !my.multis || !my.multis.length) return;
    const feeds = LS.get("rs_feeds", {}), src = LS.get("rs_feeds_src", {});
    let changed = false;
    for (const m of my.multis) {
      if (!m.subs.length) continue;
      const name = m.display || m.name;
      if (feeds[name] && src[name] !== "reddit") continue;
      if (JSON.stringify(feeds[name]) !== JSON.stringify(m.subs)) { feeds[name] = m.subs.slice(0, 100); src[name] = "reddit"; changed = true; }
    }
    if (changed) { LS.set("rs_feeds", feeds); LS.set("rs_feeds_src", src); Studio.refreshChips && Studio.refreshChips(); }
  }
  const adultOk = () => settings.adult;
  function recentItems() {
    const app = LS.get("rs_recent", []).map(t => ({ t: t.startsWith("u/") ? "u" : "r", name: t.replace(/^[ru]\//, ""), src: "app" }));
    const hist = LS.get("rs_hist", []).slice(0, 15).map(p => ({ t: "post", id: p.id, sub: p.subreddit, title: p.title, src: "app" }));
    const web = ((my && my.recent) || []).map(v => ({ ...v, src: "reddit.com" }));
    const out = [], seen = new Set();
    for (const it of [...web, ...app, ...hist].sort((a, b) => (b.at || 0) - (a.at || 0))) {
      const k = it.t + ":" + (it.id || it.name || "").toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(it);
    }
    return out.slice(0, 40);
  }
  function draw(state) {
    const favs = LS.get("rs_favs", []), feeds = LS.get("rs_feeds", {}), src = LS.get("rs_feeds_src", {});
    const match = s => !q || String(s).toLowerCase().includes(q);
    const subs = ((my && my.subs) || []).filter(s => (adultOk() || !s.nsfw) && match(s.name + " " + s.title));
    const hiddenAdult = ((my && my.subs) || []).filter(s => s.nsfw).length;
    const favRows = favs.filter(match);
    const feedRows = Object.keys(feeds).filter(match);
    const rec = recentItems().filter(r => match((r.name || "") + " " + (r.title || "") + " " + (r.sub || "")));
    const cur = (feed.target || "").toLowerCase();
    const row = (href, icon, name, small = "", act = "") => `<div class="mi ${href.toLowerCase() === "#/" + cur ? "on" : ""}" data-href="${e(href)}">${icon}<span class="nm">${e(name)}</span>${small ? `<small>${e(small)}</small>` : ""}${act}</div>`;
    const ic = (s, url) => url ? `<img src="${e(url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ic',textContent:'${e((s || "?")[0].toUpperCase())}'}))">` : `<span class="ic">${e((s || "?")[0].toUpperCase())}</span>`;
    sb.innerHTML = `<div class="mysb-head"><div style="flex:1"><div style="display:flex;align-items:center;gap:6px"><b>My Reddit</b>
        <button class="ghost" id="myref" title="Refresh from Reddit">↻</button><button class="ghost" id="myclose" title="Close sidebar">✕</button></div>
        <input type="search" id="myq" placeholder="Filter communities, feeds, recent" value="${e(q)}"></div></div>
      ${state === "loading" ? '<div class="mynote"><span class="spin"></span> Loading your communities and custom feeds…</div>' : ""}
      ${my && my.errors && my.errors.length && !(my.subs || []).length ? `<div class="mynote">Your joined communities and custom feeds need your Reddit account. Sign in with Chrome or add the Chrome extension (both in the Helper), then press ↻.<br><span style="opacity:.8">${e(my.errors[0])}</span><br><button id="myhelp" style="margin-top:6px">Open Helper</button></div>` : ""}
      <details ${LS.get("rs_sb_open_feeds", true) ? "open" : ""} data-k="feeds"><summary>Custom feeds <small>${feedRows.length}</small></summary>
        ${feedRows.map(n => row("#/f/" + n, `<span class="ic">${src[n] === "reddit" ? "↗" : "📚"}</span>`, n, (feeds[n] || []).length + " communities")).join("") || '<div class="mynote">None yet. Make one with the Feeds button above any feed.</div>'}</details>
      <details ${LS.get("rs_sb_open_subs", true) ? "open" : ""} data-k="subs"><summary>Communities <small>${subs.length + favRows.length}</small></summary>
        ${favRows.map(s => row("#/r/" + s, '<span class="ic">★</span>', "r/" + s, "favorite")).join("")}
        ${subs.map(s => row("#/r/" + s.name, ic(s.name, s.icon), "r/" + s.name, s.nsfw ? "18+" : s.members ? num(s.members) : "",
            favs.some(f => f.toLowerCase() === s.name.toLowerCase()) ? "" : `<button class="act" data-fav="${e(s.name)}" title="Add to favorites">☆</button>`)).join("")}
        ${!adultOk() && hiddenAdult ? `<div class="mynote">${hiddenAdult} 18+ communities hidden (Explicit mode is off).</div>` : ""}</details>
      <details ${LS.get("rs_sb_open_recent", true) ? "open" : ""} data-k="recent"><summary>Recent <small>${rec.length}</small></summary>
        ${rec.map(r => r.t === "post" ? row("#/comments/" + r.id, '<span class="ic">💬</span>', r.title || "Post", r.sub ? "r/" + r.sub : "")
          : r.t === "m" ? row("#/u/" + r.user, '<span class="ic">📚</span>', `${r.name} (u/${r.user})`, "custom feed")
          : row("#/" + (r.t === "u" ? "u/" : "r/") + r.name, `<span class="ic">${r.t === "u" ? "👤" : "#"}</span>`, (r.t === "u" ? "u/" : "r/") + r.name, r.src === "reddit.com" ? "reddit.com" : "")).join("")
          || '<div class="mynote">Places you visit in the app (and on reddit.com, with the extension) show up here.</div>'}</details>`;
    const qi = sb.querySelector("#myq"); qi.oninput = () => { q = qi.value.trim().toLowerCase(); const pos = qi.selectionStart; draw(); const n = sb.querySelector("#myq"); n.focus(); n.setSelectionRange(pos, pos); };
    sb.querySelector("#myref").onclick = () => loadMy(true);
    sb.querySelector("#myclose").onclick = () => { if (L.mode === "tabs") setTab("feed"); else { L.sb = false; save(); apply(); } };
    const h = sb.querySelector("#myhelp"); if (h) h.onclick = () => $("#helpbtn").click();
    sb.querySelectorAll("details").forEach(d => d.addEventListener("toggle", () => LS.set("rs_sb_open_" + d.dataset.k, d.open)));
  }
  sb.addEventListener("click", ev => {
    const f = ev.target.closest("[data-fav]");
    if (f) { ev.stopPropagation(); toggleFav(f.dataset.fav); draw(); toast("Added r/" + f.dataset.fav + " to favorites"); return; }
    const r = ev.target.closest("[data-href]"); if (!r) return;
    location.hash = r.dataset.href;
    if (L.mode === "tabs") setTab(r.dataset.href.startsWith("#/comments/") ? "post" : "feed");
  });
  document.addEventListener("rs:feed", () => { if (sb.dataset.loaded && (L.sb || L.mode === "tabs")) draw(); });

  // palette: joined communities, Reddit custom feeds and recent places
  Studio.extraItems = () => {
    const out = [];
    ((my && my.subs) || []).filter(s => adultOk() || !s.nsfw).forEach(s => out.push({ label: "r/" + s.name, hint: "Joined", run: () => (location.hash = "#/r/" + s.name) }));
    recentItems().forEach(r => out.push({ label: r.t === "post" ? (r.title || "Post") : (r.t === "u" ? "u/" : "r/") + (r.name || ""), hint: "Recent" + (r.src === "reddit.com" ? " (reddit.com)" : ""),
      run: () => (location.hash = r.t === "post" ? "#/comments/" + r.id : "#/" + (r.t === "u" ? "u/" : "r/") + r.name) }));
    out.push({ label: "My Reddit sidebar", hint: "Layout", run: () => { if (L.mode === "tabs") setTab("my"); else { L.sb = true; save(); apply(); } } });
    [["Side by side", "split"], ["Tabs", "tabs"], ["Feed full width", "feed"], ["Post full width", "post"]].forEach(([l, m]) => out.push({ label: "Layout: " + l, hint: "Layout", run: () => setMode(m) }));
    return out;
  };
  if (!my) getJSON("/api/my").then(r => { my = r; syncMultis(); }).catch(() => {});

  /* ---------------- 403 hint for 18+ feeds ---------------- */
  document.addEventListener("rs:feederror", ev => {
    const { target, message, el } = ev.detail;
    if (!/403/.test(message) || !el) return;
    const looksAdult = Studio.inExplicit() || /nsfw|gonewild|porn|nsfw_gif|realgirls/i.test(target);
    el.insertAdjacentHTML("beforeend", `<div class="hint18">${looksAdult
      ? "<b>Tip:</b> Reddit refuses 18+ communities to accounts with mature content turned off, even in your own browser. Turn it on at <b>reddit.com › Settings › Preferences › Show mature content</b> (or old.reddit.com/prefs › “I am over eighteen”), then try again."
      : "<b>Tip:</b> if this keeps happening, the community may be private or banned, or Reddit is refusing your sign-in. Open it on reddit.com in Chrome to check."}</div>`);
  });

  apply();
  if (L.sb || (L.mode === "tabs" && L.tab === "my")) loadMy();
  window.RSLayout = { setMode, setTab, reloadMy: () => loadMy(true), get state() { return { ...L }; } };
})();
