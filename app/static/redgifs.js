/* Reddit Studio: RedGIFs tab.
   #/redgifs            trending this week
   #/redgifs/<id>       one video with its creator, tags, stats, and more videos beside it
   #/redgifs/u/<name>   a creator's videos
   #/redgifs/t/<tag>    videos with a tag
   Opening a Reddit post that links to RedGIFs switches here (Settings › Explicit mode).
   Only available with Explicit mode on; 18+ media stays blurred by default. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const opt = id => Studio.opt(id);
  const e = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = document.createElement("style");
  css.textContent = `
  #rgview{flex-direction:column;overflow:auto}
  .rgwrap{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(320px,1fr);gap:18px;padding:16px 18px 40px;align-items:start}
  @media (max-width:900px){.rgwrap{grid-template-columns:1fr}}
  .rgplayer{background:#000;border-radius:14px;overflow:hidden;position:relative;display:grid;place-items:center;min-height:240px}
  .rgplayer video{display:block;width:100%;max-height:74vh;object-fit:contain;background:#000}
  .rgplayer .plyr{width:100%}
  .rghead{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0 6px}
  .rghead h2{margin:0;font-size:18px;flex:1;min-width:0}
  .rgstats{display:flex;gap:12px;flex-wrap:wrap;font-size:13px;color:var(--muted)}
  .rgtags{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
  .rgtags a{font-size:12px;padding:3px 9px;border-radius:999px;background:var(--panel2);border:1px solid var(--border);color:var(--text);text-decoration:none}
  .rgtags a:hover{border-color:var(--accent)}
  .rgside .seg{margin-bottom:10px}
  .rggrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}
  .rgcard{position:relative;border-radius:10px;overflow:hidden;background:var(--panel2);aspect-ratio:9/14;cursor:pointer;border:2px solid transparent}
  .rgcard.on{border-color:var(--accent)}
  .rgcard img{width:100%;height:100%;object-fit:cover;display:block}
  .rgcard .d{position:absolute;right:5px;bottom:5px;background:rgba(0,0,0,.7);color:#fff;font-size:11px;border-radius:5px;padding:0 5px}
  .rgcard .u{position:absolute;left:5px;bottom:5px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;border-radius:5px;padding:0 5px;max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rgblur img,.rgblur video{filter:blur(22px)}
  .o-hoverReveal .rgcard.rgblur:hover img{filter:none}
  .rgreveal{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-weight:700;cursor:pointer;background:rgba(0,0,0,.25)}
  .rgfrom{font-size:13px}
  .rgempty{padding:40px 10px;text-align:center;color:var(--muted)}`;
  document.head.appendChild(css);

  const sec = document.createElement("section"); sec.id = "rgview"; sec.className = "view";
  const tools = document.getElementById("tools"); (tools ? tools.parentElement : document.body).insertBefore(sec, tools ? tools.nextSibling : null);
  const tab = document.createElement("button"); tab.id = "tab-redgifs"; tab.setAttribute("role", "tab");
  tab.innerHTML = `<span class="ms" data-fb="RG">play_circle</span>RedGIFs`;
  tab.onclick = () => (location.hash = state.id ? "#/redgifs/" + state.id : "#/redgifs");
  const tabs = $(".tabs"); if (tabs) tabs.appendChild(tab);
  const syncTab = () => (tab.hidden = !(settings.adult && opt("redgifsTab") !== false));
  syncTab(); document.addEventListener("rs:opt", ev => { if (["explicit", "redgifsTab"].includes(ev.detail.id)) syncTab(); });
  $("#adult") && $("#adult").addEventListener("change", () => setTimeout(syncTab, 0));

  const switched = new Set();
  const state = { id: null, info: null, side: "creator", list: [], page: 1, pages: 1, key: "", from: null, reveal: false };
  const blurOn = () => settings.blur && !state.reveal;

  function show(on) {
    sec.classList.toggle("on", on);
    tab.classList.toggle("on", on);
    if (on) { $("#reader").classList.remove("on"); $("#tools").classList.remove("on"); $("#tab-reader").classList.remove("on"); $("#tab-tools").classList.remove("on"); if (window.stopVideo) stopVideo(); }
    else sec.querySelectorAll("video").forEach(v => v.pause());
  }
  window.addEventListener("hashchange", () => { if (!/^#\/redgifs(\/|$)/.test(location.hash)) show(false); });

  function route(h) {
    if (!settings.adult) { toast("RedGIFs needs Explicit mode (Settings › Explicit mode)"); history.replaceState(null, "", "#/r/popular"); return false; }
    show(true);
    const parts = h.split("/").slice(1);
    if (parts[0] === "u" && parts[1]) return openList("creator", decodeURIComponent(parts[1]), true), true;
    if (parts[0] === "t" && parts[1]) return openList("tag", decodeURIComponent(parts[1]), true), true;
    if (parts[0]) { openVideo(parts[0].toLowerCase()); return true; }
    openList("trending", "", true);
    return true;
  }

  /* ---------------- one video ---------------- */
  async function openVideo(id) {
    state.id = id;
    if (!sec.querySelector(".rgwrap")) layout();
    const main = sec.querySelector(".rgmain");
    main.innerHTML = `<div class="rgplayer"><span class="spin"></span></div>`;
    let info;
    try { info = await getJSON("/api/redgifs/info/" + encodeURIComponent(id)); }
    catch (err) { main.innerHTML = `<div class="rgempty error">${e(err.message)}<br><br><a href="https://www.redgifs.com/watch/${e(id)}" target="_blank" rel="noopener">Open on RedGIFs</a></div>`; return; }
    if (state.id !== id) return;
    state.info = info;
    const src = `/api/redgifs/${encodeURIComponent(id)}.mp4` + (opt("redgifsQuality") === "sd" ? "?q=sd" : "");
    const hide = blurOn();
    main.innerHTML = `
      ${state.from ? `<div class="rgfrom"><a href="#/comments/${e(state.from.id)}">← Back to the Reddit post</a> <span class="muted">· r/${e(state.from.subreddit)} · ${e(state.from.title)}</span></div>` : ""}
      <div class="rgplayer ${hide ? "rgblur" : ""}"><video controls playsinline loop ${opt("startMuted") || !info.audio ? "muted" : ""} poster="/api/redgifs/img/${e(id)}?poster=1" src="${e(src)}"></video>
        ${hide ? '<div class="rgreveal" data-rv>18+ — click to show</div>' : ""}</div>
      <div class="rghead"><h2>${info.user ? `<a href="#/redgifs/u/${encodeURIComponent(info.user)}">@${e(info.user)}</a>` : "RedGIFs"}</h2>
        <button data-a="dl">⬇ Download</button><button data-a="copy">Copy link</button>
        <a href="${e(info.page)}" target="_blank" rel="noopener noreferrer"><button>Open on RedGIFs</button></a></div>
      <div class="rgstats">${info.views != null ? `<span>👁 ${num(info.views)} views</span>` : ""}${info.likes != null ? `<span>♥ ${num(info.likes)}</span>` : ""}
        ${info.duration ? `<span>⏱ ${Math.round(info.duration)} s</span>` : ""}<span>${info.audio ? "🔊 has sound" : "🔇 no sound"}</span>
        ${info.width ? `<span>${info.width}×${info.height}</span>` : ""}${info.created ? `<span>${ago(info.created)} ago</span>` : ""}</div>
      <div class="rgtags">${info.tags.map(t => `<a href="#/redgifs/t/${encodeURIComponent(t)}">#${e(t)}</a>`).join("")}</div>`;
    const v = main.querySelector("video");
    v.playbackRate = Number(opt("speed")) || 1;
    if (!hide && (opt("autoplay") || opt("explicitAutoplay"))) v.play().catch(() => {});
    if (window.StudioPlayer) StudioPlayer.enhance(v, { download: () => RSViews.download(info.page) });
    main.onclick = ev => {
      const t = ev.target;
      if (t.closest("[data-rv]")) { state.reveal = true; main.querySelector(".rgplayer").classList.remove("rgblur"); t.closest("[data-rv]").remove(); v.play().catch(() => {}); drawGrid(); }
      if (t.closest('[data-a="dl"]')) RSViews.download(info.page);
      if (t.closest('[data-a="copy"]')) copyText(info.page);
    };
    // the side list: keep it if this video is already in it, otherwise show this creator's videos
    if (!state.list.some(x => x.id === id) && info.user) openList("creator", info.user, false);
    else drawGrid();
  }

  /* ---------------- lists: creator, tag, trending ---------------- */
  function layout() {
    sec.innerHTML = `<div class="rgwrap"><div class="rgmain"></div><aside class="rgside">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><div class="seg" id="rgseg">
        <button data-s="creator">Creator</button><button data-s="tag">Similar</button><button data-s="trending">Trending</button></div>
        <button class="ghost" id="rgrev" title="Show or blur all">👁</button></div>
      <div id="rgtitle" class="muted" style="font-size:12.5px;margin:-4px 0 8px"></div>
      <div class="rggrid" id="rggrid"></div><div id="rgmore" style="margin-top:10px"></div></aside></div>`;
    sec.querySelector("#rgseg").onclick = ev => {
      const b = ev.target.closest("[data-s]"); if (!b) return;
      const i = state.info;
      if (b.dataset.s === "creator" && i && i.user) openList("creator", i.user, false);
      else if (b.dataset.s === "tag" && i && i.tags.length) openList("tag", i.tags[0], false);
      else if (b.dataset.s === "trending") openList("trending", "", false);
      else toast("Open a video first");
    };
    sec.querySelector("#rgrev").onclick = () => { state.reveal = !state.reveal; if (state.id) openVideo(state.id); else drawGrid(); };
    sec.querySelector("#rggrid").onclick = ev => { const c = ev.target.closest("[data-id]"); if (c) location.hash = "#/redgifs/" + c.dataset.id; };
  }
  async function openList(kind, value, primary) {
    if (!sec.querySelector(".rgwrap")) layout();
    state.side = kind; state.key = value; state.page = 1; state.list = [];
    if (primary) { state.id = null; state.info = null; sec.querySelector(".rgmain").innerHTML = `<div class="rgempty">${kind === "creator" ? "@" + e(value) : kind === "tag" ? "#" + e(value) : "Trending this week"}<br><span style="font-size:12.5px">Pick a video.</span></div>`; }
    await loadPage();
  }
  async function loadPage() {
    const kind = state.side, key = state.key, page = state.page;
    const url = kind === "creator" ? `/api/redgifs/user/${encodeURIComponent(key)}?page=${page}` : kind === "tag" ? `/api/redgifs/tag/${encodeURIComponent(key)}?page=${page}` : `/api/redgifs/trending?page=${page}`;
    sec.querySelector("#rgtitle").textContent = (kind === "creator" ? "More from @" + key : kind === "tag" ? "Tagged #" + key : "Trending this week") + " · loading…";
    sec.querySelectorAll("#rgseg button").forEach(b => b.classList.toggle("on", b.dataset.s === kind));
    try {
      const r = await getJSON(url);
      if (state.side !== kind || state.key !== key) return;
      state.list.push(...r.items.filter(x => !state.list.some(y => y.id === x.id))); state.pages = r.pages || page;
      sec.querySelector("#rgtitle").textContent = (kind === "creator" ? "More from @" + key : kind === "tag" ? "Tagged #" + key : "Trending this week") + (r.total ? ` · ${num(r.total)} videos` : "");
      drawGrid();
    } catch (err) { sec.querySelector("#rgtitle").innerHTML = `<span class="error">${e(err.message)}</span>`; }
  }
  function drawGrid() {
    const g = sec.querySelector("#rggrid"); if (!g) return;
    const hide = blurOn();
    g.innerHTML = state.list.map(x => `<div class="rgcard ${x.id === state.id ? "on" : ""} ${hide ? "rgblur" : ""}" data-id="${e(x.id)}" title="@${e(x.user)}">
      <img loading="lazy" src="${e(x.thumb)}" alt="" onerror="this.onerror=null;this.src='/api/redgifs/img/${e(x.id)}'">${x.duration ? `<span class="d">${Math.round(x.duration)}s</span>` : ""}${state.side !== "creator" && x.user ? `<span class="u">@${e(x.user)}</span>` : ""}</div>`).join("")
      || '<div class="rgempty">Nothing here.</div>';
    const more = sec.querySelector("#rgmore");
    more.innerHTML = state.page < (state.pages || 1) ? `<button style="width:100%">Load more</button>` : "";
    if (more.firstChild) more.firstChild.onclick = () => { state.page++; loadPage(); };
    const on = g.querySelector(".rgcard.on"); if (on) on.scrollIntoView({ block: "nearest" });
  }

  /* ---------------- n / p move through the list; switch here from Reddit posts ---------------- */
  document.addEventListener("keydown", ev => {
    if (!sec.classList.contains("on") || ev.metaKey || ev.ctrlKey || ev.altKey || ev.target.closest("input,textarea,select,.plyr,.pswp")) return;
    if (ev.key === "n" || ev.key === "p") {
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (!state.list.length) return;
      let i = state.list.findIndex(x => x.id === state.id);
      i = ev.key === "n" ? i + 1 : Math.max(0, i - 1);
      if (i >= state.list.length) { if (state.page < (state.pages || 1)) { state.page++; loadPage(); } return; }
      location.hash = "#/redgifs/" + state.list[i].id;
    }
  }, true);
  document.addEventListener("rs:post", ev => {
    const { p } = ev.detail;
    if (!settings.adult || opt("redgifsTab") === false) return;
    const m = /redgifs\.com\/(?:watch|ifr|i)\/([A-Za-z]+)/i.exec((p.media && p.media.link) || p.url_overridden_by_dest || "");
    if (!m || switched.has(p.id)) return;     // once per post, so Back returns to the Reddit post and stays there
    switched.add(p.id);
    state.from = { id: p.id, title: p.title, subreddit: p.subreddit };
    location.hash = "#/redgifs/" + m[1].toLowerCase();
  });

  window.RSRedgifs = { route, openVideo, openList, state };
  if (/^#\/redgifs(\/|$)/.test(location.hash)) route(decodeURIComponent(location.hash.replace(/^#\/?/, "")));
})();
