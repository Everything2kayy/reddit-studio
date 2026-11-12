/* Reddit Studio: Feed Display Engine — one feed, many views.
   Inline views restyle #feed (Split, Compact, Grid, Masonry, Magazine, Reader); immersive views
   open over the app (Gallery, Reels, Theater); Smart picks one from what's in the feed.
   Also: hover preview, focus mode, resume position, user tags, custom feeds, comment tools, downloads.
   Loaded after the main script, so feed, settings, loadFeed, openPost, getJSON etc. exist. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
               set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const opt = id => Studio.opt(id);
  const e = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const say = m => toast(m);
  const MODES = [
    ["split", "Split pane", "Feed and post side by side", "view_sidebar"],
    ["compact", "Compact", "Dense rows, maximum posts", "view_headline"],
    ["grid", "Grid", "Uniform tiles", "grid_view"],
    ["masonry", "Masonry", "Pinterest-style columns, natural shapes", "dashboard"],
    ["magazine", "Magazine", "Featured stories layout", "newspaper"],
    ["reader", "Reader", "Text first, no thumbnails", "chrome_reader_mode"],
    ["gallery", "Gallery", "Full screen, swipe sideways", "photo_library"],
    ["reels", "Reels", "Full-screen vertical feed", "smart_display"],
    ["theater", "Theater", "Big player with comments beside it", "theaters"],
    ["smart", "Smart", "Picks the best view for each feed", "auto_awesome"],
  ];
  const INLINE = ["split", "compact", "grid", "masonry", "magazine", "reader"];
  const IMMERSIVE = ["gallery", "reels", "theater"];

  /* ---------------- styles ---------------- */
  const css = document.createElement("style");
  css.textContent = `
  #viewsel{max-width:150px}
  .v-compact #feed{gap:0;padding:0}
  .v-compact #feed .card{border-radius:0;border-width:0 0 1px;padding:5px 10px;gap:8px;align-items:center}
  .v-compact #feed .card .th{flex-basis:34px!important;height:34px!important;border-radius:6px}
  .v-compact #feed .card h3{font-size:13px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .v-compact #feed .card .cb{display:flex;flex-direction:column-reverse}
  .v-compact #feed .card .meta{font-size:11px;gap:6px}
  .v-reader #feed .card .th{display:none}
  .v-reader #feed .card{padding:14px 16px}
  .v-reader #feed .card h3{font-family:Georgia,"Iowan Old Style",serif;font-size:18px;font-weight:600;line-height:1.4}
  .v-reader .cols:not(.wide){grid-template-columns:minmax(360px,620px) 1fr}
  .v-masonry #feed.grid{display:block;column-gap:8px}
  .v-masonry #feed.grid .card{break-inside:avoid;margin-bottom:8px;display:flex}
  .v-masonry #feed.grid .card .th{height:auto!important;min-height:60px;background:none!important}
  .v-masonry #feed.grid .card .th img.nat{display:block;width:100%;height:auto;border-radius:inherit}
  .v-magazine #feed.grid{grid-auto-flow:dense}
  .v-magazine #feed.grid .card:nth-child(7n+1){grid-column:span 2;grid-row:span 2}
  .v-magazine #feed.grid .card:nth-child(7n+1) .th{height:360px}
  .v-magazine #feed.grid .card:nth-child(7n+1) h3{font-size:19px}
  .v-magazine #feed.grid .card:nth-child(7n+4){grid-column:span 2}
  .aspect #feed.grid .card .th{background-size:contain!important;background-color:#000}
  .focus header,.focus .rbar,.focus .chips,.focus #limited{display:none!important}
  #focusexit{position:fixed;top:8px;right:8px;z-index:60;opacity:.35}#focusexit:hover{opacity:1}
  #hoverprev{position:fixed;z-index:70;pointer-events:none;background:#000;border:1px solid var(--border);border-radius:10px;overflow:hidden;box-shadow:0 14px 40px rgba(0,0,0,.5)}
  #hoverprev img{display:block;max-width:420px;max-height:420px}
  .utag{font-size:10.5px;font-weight:700;border-radius:5px;padding:0 5px;color:#fff;margin-left:2px}
  .ctools{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:-4px 0 8px}
  .ctools input{padding:4px 8px;font-size:12.5px;width:170px}
  .ctools .newc{font-size:12px;color:var(--accent);font-weight:600}
  .cmt.found>.cbody{background:color-mix(in srgb,var(--accent) 18%,transparent);border-radius:6px}
  .oponly .cmt:not(:has(> .ch .op)):not(:has(.cmt .ch .op)){display:none}
  /* immersive */
  #rv{position:fixed;inset:0;z-index:110;background:#000;color:#fff;display:flex}
  #rv .rvbar{position:absolute;top:0;left:0;right:0;display:flex;gap:6px;align-items:center;padding:10px 12px;z-index:5;background:linear-gradient(#000a,#0000)}
  #rv .rvbar b{flex:1;font-size:13px;opacity:.85}
  #rv button{background:rgba(255,255,255,.12);color:#fff;border:0}
  #rv button:hover{background:rgba(255,255,255,.22)}
  #rv .stage{flex:1;position:relative;display:grid;place-items:center;min-width:0}
  #rv .stage img,#rv .stage video{max-width:100%;max-height:100vh;object-fit:contain}
  #rv .nav{position:absolute;top:50%;transform:translateY(-50%);font-size:26px;padding:14px 16px;z-index:4}
  #rv .info{position:absolute;left:0;right:0;bottom:0;padding:18px 16px 14px;background:linear-gradient(#0000,#000c);font-size:14px;z-index:3}
  #rv .info h4{margin:0 0 4px;font-size:16px}
  #rv .info small{opacity:.75}
  #rv .blurred{filter:blur(28px)}
  #rv .rev{position:absolute;inset:0;display:grid;place-items:center;font-weight:700;cursor:pointer;z-index:2}
  #rv .count{font-size:12px;opacity:.7}
  #rv.reels .scroller{flex:1;overflow-y:scroll;scroll-snap-type:y mandatory;height:100vh}
  #rv.reels .reel{height:100vh;scroll-snap-align:start;position:relative;display:grid;place-items:center}
  #rv.reels .reel img,#rv.reels .reel video{max-width:100%;max-height:100vh;object-fit:contain}
  #rv.reels .reel .side{position:absolute;right:12px;bottom:90px;display:grid;gap:10px;z-index:3}
  #rv.reels .reel .side button{width:46px;height:46px;border-radius:50%;justify-content:center;font-size:18px}
  #rv.theater .panel{width:400px;flex:none;background:var(--panel);color:var(--text);overflow:auto;padding:16px;border-left:1px solid var(--border)}
  #rv.theater.nopanel .panel{display:none}
  #rv.theater .rvbar{right:400px}#rv.theater.nopanel .rvbar{right:0}
  .v-masonry #feed.grid .card .th:not(:has(img)){display:none}
  #rv .textcard{max-width:720px;padding:40px;font-size:18px;line-height:1.6;max-height:80vh;overflow:auto}
  /* downloader */
  .dlbar{height:8px;background:var(--panel2);border-radius:4px;overflow:hidden;margin:10px 0}
  .dlbar i{display:block;height:100%;background:var(--accent);width:0}
  `;
  document.head.appendChild(css);

  /* ---------------- helpers ---------------- */
  const visible = () => feed.posts.filter(matches);
  const hasMedia = p => ["image", "gallery", "video"].includes(p.media && p.media.type);
  const target = () => feed.target || "";
  const revealed = new Set();
  let revealAll = false;
  const hiddenFor = p => (isAdult(p) && settings.blur && !opt("overlayReveal") && !revealAll && !revealed.has(p.id)) || (p.spoiler && !revealed.has(p.id));
  function srcOf(p) {
    const m = p.media || {};
    if (m.type === "video" && m.video) {
      let mp4 = m.video.mp4;
      if (/\/api\/redgifs\//.test(mp4) && opt("redgifsQuality") === "sd") mp4 += "?q=sd";
      return { kind: "video", list: [mp4], hls: m.video.hls, gif: m.video.gif };
    }
    if (m.type === "gallery" && m.images && m.images.length) return { kind: "image", list: m.images };
    if (m.type === "image" && m.images && m.images[0]) return { kind: "image", list: [m.images[0]] };
    return null;
  }
  function attachVideo(v, s) {
    if (s.hls && window.Hls && Hls.isSupported()) {
      const h = new Hls(); h.loadSource(s.hls); h.attachMedia(v); v._hls = h;
      h.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { h.destroy(); v._hls = null; v.src = s.list[0]; } });
    } else if (s.hls && v.canPlayType("application/vnd.apple.mpegurl")) { v.src = s.hls; v.onerror = () => { v.onerror = null; v.src = s.list[0]; }; }
    else v.src = s.list[0];
  }
  function mediaEl(p, idx = 0, autoplay = true) {
    const s = srcOf(p), hide = hiddenFor(p);
    if (!s) return `<div class="textcard"><h3>${e(p.title)}</h3><p style="opacity:.75">${e(p.domain)}</p><p>Text post — press <b>c</b> to read it with comments.</p></div>`;
    const cls = hide ? ' class="blurred"' : "";
    const body = s.kind === "video"
      ? `<video${cls} playsinline ${s.gif || !opt("overlaySound") ? "muted" : ""} ${s.gif ? "loop" : ""} ${autoplay && !hide ? "autoplay" : ""} controls poster="${e(p.thumb)}" data-v="${e(p.id)}"></video>`
      : `<img${cls} src="${e(s.list[Math.min(idx, s.list.length - 1)])}" alt="">`;
    return body + (hide ? `<div class="rev" data-rev="${e(p.id)}">${isAdult(p) ? "18+" : "Spoiler"} — click to show (r shows all)</div>` : "");
  }
  function wireMedia(root, p) {
    const v = root.querySelector("video[data-v]");
    if (v) attachVideo(v, srcOf(p));
    const rv = root.querySelector("[data-rev]");
    if (rv) rv.onclick = ev => { ev.stopPropagation(); revealed.add(p.id); root.querySelectorAll(".blurred").forEach(x => x.classList.remove("blurred")); rv.remove(); if (v) v.play().catch(() => {}); };
    return v;
  }
  function stopAll(root) { (root || document).querySelectorAll("#rv video").forEach(v => { v.pause(); if (v._hls) { v._hls.destroy(); v._hls = null; } }); }

  /* ---------------- view selection ---------------- */
  let view = LS.get("rs_view", ls.get("rs_layout", "list") === "grid" ? "grid" : "split");
  const perFeed = () => LS.get("rs_view_by_feed", {});
  function viewFor(t) { return (opt("rememberView") && perFeed()[t]) || view; }
  function setView(id, fromUser = true) {
    if (!MODES.some(m => m[0] === id)) return;
    if (fromUser) {
      view = id; LS.set("rs_view", id);
      if (opt("rememberView") && target()) { const m = perFeed(); m[target()] = id; LS.set("rs_view_by_feed", m); }
    }
    if (IMMERSIVE.includes(id)) { openImmersive(id); syncSelect(); return; }
    applyInline(id === "smart" ? smartPick() : id);
    syncSelect();
  }
  function applyInline(id) {
    const cl = document.documentElement.classList;
    INLINE.forEach(m => cl.remove("v-" + m));
    cl.add("v-" + id);
    setLayout(["grid", "masonry", "magazine"].includes(id) ? "grid" : "list");
    cl.toggle("aspect", !!opt("aspectLock"));
    applyColumns();
    if (id === "masonry") naturalThumbs();
  }
  function currentInline() { return INLINE.find(m => document.documentElement.classList.contains("v-" + m)) || "split"; }
  function smartPick() {
    const ps = visible(); if (!ps.length) return "split";
    const media = ps.filter(hasMedia).length / ps.length, text = ps.filter(p => p.media && p.media.type === "text").length / ps.length;
    return media > 0.65 ? opt("smartMedia") : text > 0.6 ? "reader" : "split";
  }
  function applyColumns() {
    const n = opt("viewColumns"), f = $("#feed"); if (!f) return;
    const masonry = document.documentElement.classList.contains("v-masonry");
    f.style.gridTemplateColumns = n !== "auto" && !masonry ? `repeat(${n},minmax(0,1fr))` : "";
    f.style.columnCount = masonry && n !== "auto" ? n : "";
    f.style.columnWidth = masonry && n === "auto" ? (opt("gridMin") || 220) + "px" : "";
  }
  function naturalThumbs() {
    $$("#feed .card .th").forEach(th => {
      if (th.querySelector("img.nat")) return;
      const m = /url\(['"]?(.*?)['"]?\)/.exec(th.style.backgroundImage || ""); if (!m) return;
      const img = document.createElement("img"); img.className = "nat"; img.loading = "lazy"; img.src = m[1];
      if (th.classList.contains("blurred")) img.style.filter = "blur(16px)";
      th.prepend(img);
    });
  }
  function syncSelect() { const s = $("#viewsel"); if (s) s.value = view; }
  function buildSelector() {
    const lay = $("#layout"); if (!lay || $("#viewsel")) return;
    lay.style.display = "none";
    lay.insertAdjacentHTML("afterend", `<select id="viewsel" title="View (v cycles)" aria-label="View">${MODES.map(([id, l, d]) => `<option value="${id}" title="${e(d)}">${e(l)}</option>`).join("")}</select>
      <button id="dlbtn" class="ghost" title="Download media from this feed"><span class="ms" data-fb="⬇">download</span></button>
      <button id="feedsbtn" class="ghost" title="Custom feeds"><span class="ms" data-fb="Feeds">dynamic_feed</span></button>`);
    $("#viewsel").onchange = ev => setView(ev.target.value);
    $("#dlbtn").onclick = () => download();
    $("#feedsbtn").onclick = () => feedsManager();
    syncSelect();
  }

  /* ---------------- immersive views: Gallery, Reels, Theater ---------------- */
  let rv = null, rvMode = null, rvIdx = 0, rvTimer = 0, rvPosts = [];
  function openImmersive(mode, startId) {
    closeImmersive(true);
    rvPosts = mode === "theater" ? visible() : visible().filter(hasMedia);
    if (!rvPosts.length) { say("No photos or videos in this feed" + (feed.posts.length ? " (check the filter)" : "")); applyInline(currentInline()); return; }
    rvIdx = Math.max(0, startId ? rvPosts.findIndex(p => p.id === startId) : 0);
    rvMode = mode;
    rv = document.createElement("div"); rv.id = "rv"; rv.className = mode;
    document.body.appendChild(rv);
    if (mode === "reels") drawReels(); else drawSlide();
    document.addEventListener("keydown", rvKeys, true);
  }
  function closeImmersive(silent) {
    if (!rv) return;
    stopAll(rv); clearTimeout(rvTimer); rv.remove(); rv = null; rvMode = null;
    document.removeEventListener("keydown", rvKeys, true);
    if (!silent && IMMERSIVE.includes(view)) { view = currentInline(); syncSelect(); }
  }
  function bar(extra = "") {
    const p = rvPosts[rvIdx] || {};
    return `<div class="rvbar"><b>${e(MODES.find(m => m[0] === rvMode)[1])} · ${e(feed.target)} <span class="count">${rvIdx + 1} / ${rvPosts.length}</span></b>${extra}
      <button data-k="reveal" title="Show all 18+ (r)">${revealAll ? "🙈 Blur" : "👁 Reveal"}</button>
      <button data-k="bm" title="Bookmark (b)">🔖</button><button data-k="dl" title="Download (d)">⬇</button>
      <button data-k="open" title="Open with comments (c)">💬</button><button data-k="x" title="Close (Esc)">✕</button></div>`;
  }
  function drawSlide() {
    const p = rvPosts[rvIdx]; if (!p) return;
    stopAll(rv);
    const theater = rvMode === "theater";
    rv.innerHTML = `${bar(rvMode === "gallery" ? `<button data-k="play" title="Slideshow (space)">${rvTimer ? "⏸ Slideshow" : "▶ Slideshow"}</button>` : `<button data-k="panel" title="Info panel (i)">ℹ Panel</button>`)}
      <div class="stage">${mediaEl(p, 0, true)}
        <button class="nav" data-k="prev" style="left:10px">‹</button><button class="nav" data-k="next" style="right:10px">›</button>
        ${theater ? "" : `<div class="info"><h4>${e(p.title)}</h4><small>r/${e(p.subreddit)} · u/${e(p.author)}${p.score != null ? ` · ▲ ${num(p.score)} · 💬 ${num(p.comments)}` : ""}${(p.media.images || []).length > 1 ? ` · ${p.media.images.length} images (open to see all)` : ""}</small></div>`}</div>
      ${theater ? `<aside class="panel"><div class="muted" style="font-size:12px">r/${e(p.subreddit)} · u/${e(p.author)} · ${ago(p.created_utc)} ago</div><h3 style="margin:6px 0">${e(p.title)}</h3>
        <div class="meta">${p.score != null ? `<span>▲ ${num(p.score)}</span><span>💬 ${num(p.comments)}</span>` : ""}</div><div id="rvc"><p class="muted">Loading comments…</p></div></aside>` : ""}`;
    const v = wireMedia(rv.querySelector(".stage"), p);
    if (v && rvMode === "gallery" && rvTimer) v.addEventListener("ended", next, { once: true });
    rv.onclick = rvClick;
    preload(rvIdx + 1);
    if (theater) loadComments(p);
    maybeMore();
  }
  async function loadComments(p) {
    try {
      const r = await getJSON(`/api/reader/thread?ref=${encodeURIComponent(p.id)}&sort=top`);
      const box = rv && rv.querySelector("#rvc"); if (!box || rvPosts[rvIdx] !== p) return;
      box.innerHTML = (r.post.body_html ? `<div class="md">${sanitize(r.post.body_html)}</div>` : "") + `<h4 style="margin:14px 0 4px">Comments</h4>` + (r.comments.length ? cmtHTML(r.comments, 0) : '<p class="muted">No comments yet.</p>');
      wireLinks(box);
    } catch (err) { const box = rv && rv.querySelector("#rvc"); if (box) box.innerHTML = `<p class="error">${e(err.message)}</p>`; }
  }
  function preload(i) { const p = rvPosts[i], s = p && srcOf(p); if (s && s.kind === "image") { const im = new Image(); im.src = s.list[0]; } }
  function next() { if (rvIdx < rvPosts.length - 1) { rvIdx++; drawSlide(); slideshow(); } else if (feed.after) { maybeMore(true); } }
  function prev() { if (rvIdx > 0) { rvIdx--; drawSlide(); slideshow(); } }
  function slideshow() {
    clearTimeout(rvTimer); if (!rvTimer && rvTimer !== -1) return;
    const p = rvPosts[rvIdx], s = p && srcOf(p);
    if (s && s.kind === "video" && !s.gif) { rvTimer = -1; return; }   // videos advance when they end
    rvTimer = setTimeout(next, (Number(opt("gallerySlideshow")) || 5) * 1000);
  }
  function toggleSlideshow() { if (rvTimer) { clearTimeout(rvTimer); rvTimer = 0; } else { rvTimer = -1; slideshow(); } drawSlide(); }
  let loadingMore = false;
  async function maybeMore(force) {
    if (loadingMore || !feed.after || (!force && rvIdx < rvPosts.length - 4)) return;
    loadingMore = true;
    try { await loadFeed(feed.target, true); } finally { loadingMore = false; }
  }
  document.addEventListener("rs:feed", () => {
    if (!rv) return;
    const have = new Set(rvPosts.map(p => p.id));
    const add = (rvMode === "theater" ? visible() : visible().filter(hasMedia)).filter(p => !have.has(p.id));
    if (!add.length) return;
    rvPosts.push(...add);
    if (rvMode === "reels") appendReels(add);
    else { const c = rv.querySelector(".count"); if (c) c.textContent = `${rvIdx + 1} / ${rvPosts.length}`; }
  });
  function act(k) {
    const p = rvPosts[rvIdx];
    if (k === "x") closeImmersive();
    else if (k === "next") next();
    else if (k === "prev") prev();
    else if (k === "play") toggleSlideshow();
    else if (k === "panel") rv.classList.toggle("nopanel");
    else if (k === "reveal") { revealAll = !revealAll; rvMode === "reels" ? (rv.querySelectorAll(".reel").forEach(r => (r.dataset.built = "")), buildNear()) : drawSlide(); rv.querySelector('[data-k="reveal"]').textContent = revealAll ? "🙈 Blur" : "👁 Reveal"; }
    else if (k === "bm" && p) Studio.toggleBookmark(p);
    else if (k === "dl" && p) download(p.id);
    else if (k === "open" && p) { closeImmersive(); location.hash = "#/comments/" + p.id; }
  }
  function rvClick(ev) { const b = ev.target.closest("[data-k]"); if (b) { ev.stopPropagation(); act(b.dataset.k); } }
  function rvKeys(ev) {
    if (!rv || ev.metaKey || ev.ctrlKey) return;
    const k = ev.key, reels = rvMode === "reels";
    const map = { Escape: "x", ArrowRight: reels ? null : "next", ArrowLeft: reels ? null : "prev", " ": rvMode === "gallery" ? "play" : null,
                  c: "open", b: "bm", d: "dl", r: "reveal", i: "panel" };
    if (reels && (k === "ArrowDown" || k === "j")) { ev.preventDefault(); reelStep(1); return; }
    if (reels && (k === "ArrowUp" || k === "k")) { ev.preventDefault(); reelStep(-1); return; }
    if (!reels && (k === "j" || k === "k")) { ev.preventDefault(); act(k === "j" ? "next" : "prev"); return; }
    if (k === "m") { const v = rv.querySelector(reels ? `.reel[data-i="${rvIdx}"] video` : "video"); if (v) v.muted = !v.muted; return; }
    if (map[k]) { ev.preventDefault(); ev.stopPropagation(); act(map[k]); }
  }

  /* Reels: vertical snap scroller, plays what's on screen */
  let io = null;
  function drawReels() {
    rv.innerHTML = bar() + `<div class="scroller"></div>`;
    rv.onclick = rvClick;
    io = new IntersectionObserver(ents => ents.forEach(en => {
      const el = en.target, v = el.querySelector("video");
      if (en.isIntersecting && en.intersectionRatio > 0.6) {
        rvIdx = +el.dataset.i; const c = rv.querySelector(".count"); if (c) c.textContent = `${rvIdx + 1} / ${rvPosts.length}`;
        buildNear(); const vv = el.querySelector("video");
        if (vv && !vv.classList.contains("blurred")) vv.play().catch(() => {});
        reelTimer(el); maybeMore();
      } else if (v) v.pause();
    }), { root: rv.querySelector(".scroller"), threshold: [0.6] });
    appendReels(rvPosts, 0);
    setTimeout(() => { const el = rv.querySelector(`.reel[data-i="${rvIdx}"]`); el && el.scrollIntoView(); }, 30);
  }
  function appendReels(list, offset) {
    const sc = rv.querySelector(".scroller"), start = offset ?? (rvPosts.length - list.length);
    list.forEach((p, n) => {
      const el = document.createElement("section"); el.className = "reel"; el.dataset.i = start + n;
      sc.appendChild(el); io.observe(el);
    });
    buildNear();
  }
  function buildNear() {
    if (!rv) return;
    rv.querySelectorAll(".reel").forEach(el => {
      const i = +el.dataset.i, near = Math.abs(i - rvIdx) <= 2;
      if (near && !el.dataset.built) {
        const p = rvPosts[i]; el.dataset.built = "1";
        el.innerHTML = mediaEl(p, 0, false) + `<div class="info"><h4>${e(p.title)}</h4><small>r/${e(p.subreddit)} · u/${e(p.author)}${p.score != null ? ` · ▲ ${num(p.score)}` : ""}</small></div>
          <div class="side"><button data-k="bm" title="Bookmark">🔖</button><button data-k="open" title="Comments">💬</button><button data-k="dl" title="Download">⬇</button></div>`;
        const v = wireMedia(el, p); if (v) { v.loop = opt("reelsAdvance") !== "end"; v.addEventListener("ended", () => { if (opt("reelsAdvance") === "end" && +el.dataset.i === rvIdx) reelStep(1); }); }
      } else if (!near && el.dataset.built && Math.abs(i - rvIdx) > 4) {
        el.querySelectorAll("video").forEach(v => { v.pause(); if (v._hls) v._hls.destroy(); }); el.innerHTML = ""; el.dataset.built = "";
      }
    });
  }
  function reelStep(d) { const el = rv && rv.querySelector(`.reel[data-i="${Math.max(0, Math.min(rvPosts.length - 1, rvIdx + d))}"]`); el && el.scrollIntoView({ behavior: opt("reduceMotion") ? "auto" : "smooth" }); }
  function reelTimer(el) {
    clearTimeout(rvTimer); const s = Number(opt("reelsAdvance"));
    if (s > 0) rvTimer = setTimeout(() => { if (+el.dataset.i === rvIdx) reelStep(1); }, s * 1000);
  }

  /* ---------------- hover preview ---------------- */
  let hpTimer = 0;
  function hoverPreview() {
    const fd = $("#feed"); if (!fd) return;
    fd.addEventListener("mouseover", ev => {
      const c = ev.target.closest(".card"); if (!c || !opt("hoverPreview") || ["grid", "masonry", "magazine"].includes(currentInline())) return;
      clearTimeout(hpTimer);
      hpTimer = setTimeout(() => {
        const p = feed.posts.find(x => x.id === c.dataset.id); if (!p || hiddenFor(p)) return;
        const s = srcOf(p); const src = s && s.kind === "image" ? s.list[0] : p.thumb; if (!src) return;
        let h = $("#hoverprev"); if (!h) { h = document.createElement("div"); h.id = "hoverprev"; document.body.appendChild(h); }
        h.innerHTML = `<img src="${e(src)}" alt="">`;
        const r = c.getBoundingClientRect(); h.style.left = Math.min(r.right + 10, innerWidth - 440) + "px"; h.style.top = Math.max(8, Math.min(r.top, innerHeight - 440)) + "px"; h.hidden = false;
      }, 450);
    });
    fd.addEventListener("mouseout", ev => { if (!ev.relatedTarget || !ev.relatedTarget.closest || !ev.relatedTarget.closest(".card")) { clearTimeout(hpTimer); const h = $("#hoverprev"); if (h) h.hidden = true; } });
    fd.addEventListener("click", () => { clearTimeout(hpTimer); const h = $("#hoverprev"); if (h) h.hidden = true; });
  }

  /* ---------------- focus mode ---------------- */
  function focus(on) {
    document.documentElement.classList.toggle("focus", on);
    let b = $("#focusexit");
    if (on && !b) { b = document.createElement("button"); b.id = "focusexit"; b.textContent = "Exit focus (z)"; b.onclick = () => Studio.set("focusMode", false); document.body.appendChild(b); }
    if (!on && b) b.remove();
  }

  /* ---------------- resume position ---------------- */
  let restored = null;
  function trackScroll() {
    const w = $("#feedwrap"); if (!w) return;
    let t = 0;
    w.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(() => { if (!opt("resumeScroll") || !target()) return; const m = LS.get("rs_scroll", {}); m[target()] = { top: w.scrollTop, n: feed.posts.length, at: Date.now() }; LS.set("rs_scroll", m); }, 300); });
  }
  function restoreScroll() {
    if (!opt("resumeScroll") || restored === target()) return;
    restored = target();
    const s = LS.get("rs_scroll", {})[target()];
    if (s && Date.now() - s.at < 6 * 3600e3 && s.top > 0) requestAnimationFrame(() => { $("#feedwrap").scrollTop = s.top; });
  }

  /* ---------------- user tags ---------------- */
  const COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#12a594", "#0090ff", "#6e56cf", "#d6409f", "#8d8d8d"];
  const tags = () => LS.get("rs_tags", {});
  function tagUser(user) {
    const t = tags(), cur = t[user.toLowerCase()] || {};
    const label = prompt(`Tag u/${user} (blank removes the tag):`, cur.label || "");
    if (label === null) return;
    if (!label.trim()) delete t[user.toLowerCase()];
    else {
      const ci = prompt("Color 1-9: 1 red, 2 orange, 3 yellow, 4 green, 5 teal, 6 blue, 7 purple, 8 pink, 9 gray", String(COLORS.indexOf(cur.color) + 1 || 6));
      t[user.toLowerCase()] = { label: label.trim().slice(0, 24), color: COLORS[(Number(ci) || 6) - 1] || COLORS[5] };
    }
    LS.set("rs_tags", t); decorateTags(document); say("Saved");
  }
  function decorateTags(root) {
    const t = tags(); if (!Object.keys(t).length) return;
    root.querySelectorAll(".card[data-author]").forEach(c => {
      const tg = t[c.dataset.author.toLowerCase()]; const sp = [...c.querySelectorAll(".meta span")].find(s => s.textContent === "u/" + c.dataset.author);
      if (tg && sp && !sp.querySelector(".utag")) sp.insertAdjacentHTML("beforeend", ` <span class="utag" style="background:${tg.color}">${e(tg.label)}</span>`);
    });
    root.querySelectorAll(".cmt[data-author] > .ch > b").forEach(b => {
      const tg = t[b.closest(".cmt").dataset.author.toLowerCase()];
      if (tg && !b.nextElementSibling?.classList.contains("utag")) b.insertAdjacentHTML("afterend", `<span class="utag" style="background:${tg.color}">${e(tg.label)}</span>`);
    });
  }

  /* ---------------- custom feeds ---------------- */
  const feeds = () => LS.get("rs_feeds", {});
  function addToFeed(sub) {
    const f = feeds(), names = Object.keys(f);
    const name = (prompt(`Add r/${sub} to which custom feed?` + (names.length ? "\nExisting: " + names.join(", ") : "\n(type a new name)"), names[0] || "My feed") || "").trim();
    if (!name) return;
    f[name] = [...new Set([...(f[name] || []), sub])]; LS.set("rs_feeds", f); Studio.refreshChips(); say(`Added to 📚 ${name}`);
  }
  function feedsManager() {
    const m = document.createElement("div"); m.className = "modalbg"; m.style.zIndex = 125;
    const draw = () => {
      const f = feeds();
      m.innerHTML = `<div class="modal" style="width:min(560px,100%)"><div style="display:flex;align-items:center"><b style="flex:1;font-size:17px">Custom feeds</b><button class="ghost" data-x>✕</button></div>
        <p class="muted" style="font-size:13px">Combine communities into one feed. Each gets a chip, a palette entry, and its own remembered view.</p>
        ${Object.entries(f).map(([n, subs]) => `<div class="setrow"><span class="lbl"><b>📚 ${e(n)}</b><small>${subs.map(s => "r/" + e(s)).join(", ")}</small></span>
          <button data-open="${e(n)}">Open</button><button data-edit="${e(n)}">Edit</button><button data-del="${e(n)}">Delete</button></div>`).join("") || '<p class="muted">No custom feeds yet.</p>'}
        <h3 style="margin:14px 0 6px">New feed</h3>
        <input type="text" id="cf-name" placeholder="Name, e.g. Tech" style="width:100%;margin-bottom:6px"><input type="text" id="cf-subs" placeholder="Communities, comma separated: apple, MacOS, iphone" style="width:100%">
        <div style="margin-top:8px"><button class="primary" id="cf-add">Create</button></div></div>`;
    };
    draw(); document.body.appendChild(m);
    m.onclick = ev => {
      const t = ev.target;
      if (t === m || t.closest("[data-x]")) return m.remove();
      const f = feeds();
      if (t.dataset.open) { m.remove(); location.hash = "#/f/" + t.dataset.open; }
      if (t.dataset.del && confirm(`Delete 📚 ${t.dataset.del}?`)) { delete f[t.dataset.del]; LS.set("rs_feeds", f); Studio.refreshChips(); draw(); }
      if (t.dataset.edit) { const v = prompt("Communities (comma separated):", f[t.dataset.edit].join(", ")); if (v != null) { f[t.dataset.edit] = clean(v); LS.set("rs_feeds", f); Studio.refreshChips(); draw(); } }
      if (t.id === "cf-add") {
        const name = $("#cf-name").value.trim().replace(/[\/#]/g, ""), subs = clean($("#cf-subs").value);
        if (!name || !subs.length) return say("Give it a name and at least one community");
        f[name] = subs; LS.set("rs_feeds", f); Studio.refreshChips(); draw(); say(`Created 📚 ${name}`);
      }
    };
  }
  const clean = v => [...new Set(String(v).split(/[,\s]+/).map(s => s.trim().replace(/^\/?r\//i, "")).filter(s => /^[A-Za-z0-9_]{2,21}$/.test(s)))];

  /* ---------------- comment tools ---------------- */
  function commentTools(p, el) {
    if (!opt("commentTools")) return;
    const head = el.querySelector(".chead"); if (!head) return;
    const total = el.querySelectorAll(".cmt").length, seen = LS.get("rs_seen", {}), before = seen[p.id];
    seen[p.id] = Math.max(total, before || 0); const keys = Object.keys(seen); if (keys.length > 2000) delete seen[keys[0]]; LS.set("rs_seen", seen);
    head.insertAdjacentHTML("afterend", `<div class="ctools"><label style="font-size:12.5px;display:flex;gap:5px;align-items:center"><input type="checkbox" id="ct-op">OP only</label>
      <input type="search" id="ct-q" placeholder="Find in comments"><span class="muted" id="ct-n" style="font-size:12px"></span>
      ${before != null && total > before ? `<span class="newc">${total - before} new since your last visit</span>` : ""}
      <span class="muted" style="font-size:12px;margin-left:auto">[ ] jump between top comments</span></div>`);
    el.querySelector("#ct-op").onchange = ev => el.querySelector("#comments").classList.toggle("oponly", ev.target.checked);
    el.querySelector("#ct-q").oninput = ev => {
      const q = ev.target.value.trim().toLowerCase(); let n = 0, first = null;
      el.querySelectorAll(".cmt").forEach(c => { const hit = q && c.querySelector(":scope > .cbody").textContent.toLowerCase().includes(q); c.classList.toggle("found", !!hit); if (hit) { n++; first = first || c; } });
      el.querySelector("#ct-n").textContent = q ? `${n} match${n === 1 ? "" : "es"}` : "";
      if (first) first.scrollIntoView({ block: "center" });
    };
  }
  document.addEventListener("keydown", ev => {
    if (rv || ev.metaKey || ev.ctrlKey || ev.altKey || ev.target.closest("input,textarea,select,.plyr,.pswp")) return;
    if (ev.key === "[" || ev.key === "]") {
      const tops = $$("#comments > .cmt"); if (!tops.length) return;
      const d = $("#detail"), y = d.getBoundingClientRect().top + 60;
      let i = tops.findIndex(c => c.getBoundingClientRect().top > y + 2);
      if (ev.key === "[") { i = tops.findIndex(c => c.getBoundingClientRect().top >= y - 2) - 1; i = Math.max(0, i); }
      if (i < 0) i = tops.length - 1;
      tops[i].scrollIntoView({ block: "start" });
    }
    if (ev.key === "v" && !ev.shiftKey) { const ids = MODES.map(m => m[0]); setView(ids[(ids.indexOf(view) + 1) % ids.length]); say("View: " + MODES.find(m => m[0] === view)[1]); }
    if (ev.key === "V") { openImmersive("reels"); }
    if (ev.key === "z") Studio.set("focusMode", !opt("focusMode"));
  });

  /* ---------------- bulk downloads ---------------- */
  async function api(url, body) {
    return getJSON(url, body === undefined ? undefined : { method: "POST", headers: { "X-Reddit-Studio": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  let dlPoll = 0;
  function download(postId) {
    const m = document.createElement("div"); m.className = "modalbg"; m.style.zIndex = 126;
    const tgt = postId || (feed.target && !["bookmarks"].includes(feed.target) ? feed.target : "r/pics");
    m.innerHTML = `<div class="modal" style="width:min(560px,100%)"><div style="display:flex;align-items:center"><b style="flex:1;font-size:17px">Download media</b><button class="ghost" data-x>✕</button></div>
      <p class="muted" style="font-size:13px">Saves photos, galleries and videos into <b>Reddit Studio Files › Media</b>. Running it again only fetches new files. Videos keep their sound when ffmpeg is installed (<code>brew install ffmpeg</code>).</p>
      <div class="setrow"><span class="lbl">From<small>r/name, r/a+b, u/name, or a post link</small></span><input type="text" id="dl-t" value="${e(tgt)}"></div>
      ${postId ? "" : `<div class="setrow"><span class="lbl">How many posts</span><select id="dl-n">${[25, 50, 100, 250, 500, 1000].map(n => `<option ${n === 100 ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="setrow"><span class="lbl">Sort</span><select id="dl-s">${["hot", "new", "top", "rising"].map(s => `<option ${s === $("#rsort").value ? "selected" : ""}>${s}</option>`).join("")}</select>
        <select id="dl-time">${["day", "week", "month", "year", "all"].map(s => `<option ${s === $("#rtime").value ? "selected" : ""}>${s}</option>`).join("")}</select></div>`}
      <div class="setrow"><span class="lbl">Include</span><span style="display:flex;gap:10px;flex-wrap:wrap;font-size:13px">
        ${[["image", "Images & galleries"], ["video", "Videos"], ["gif", "GIFs"], ["redgifs", "RedGIFs"]].map(([k, l]) => `<label><input type="checkbox" data-kind="${k}" checked> ${l}</label>`).join("")}</span></div>
      ${settings.adult ? `<label class="setrow"><span class="lbl">Include 18+ posts</span><input type="checkbox" class="sw" id="dl-nsfw" checked></label>` : ""}
      <div style="display:flex;gap:6px;margin-top:10px"><button class="primary" id="dl-go">Start</button><button id="dl-stop">Stop</button><button id="dl-open">Open folder</button></div>
      <div class="dlbar"><i id="dl-bar"></i></div><div id="dl-st" class="muted" style="font-size:13px">Ready.</div>
      <pre class="out" id="dl-log" style="max-height:200px;font-size:11.5px;margin-top:8px"></pre></div>`;
    document.body.appendChild(m);
    const poll = async () => {
      clearTimeout(dlPoll);
      if (!m.isConnected) return;
      try {
        const s = await api("/api/media");
        $("#dl-bar").style.width = s.total ? Math.round(s.done / s.total * 100) + "%" : (s.running ? "5%" : "0");
        $("#dl-st").textContent = s.target ? `${s.running ? "Downloading" : "Done"}: ${s.done}/${s.total} checked · ${s.saved} saved · ${s.skipped} already had · ${s.failed} failed · ${(s.bytes / 1048576).toFixed(1)} MB` : "Ready.";
        $("#dl-log").textContent = s.log.join("\n"); $("#dl-log").scrollTop = 1e9;
        if (s.running) dlPoll = setTimeout(poll, 800);
      } catch (err) { $("#dl-st").textContent = err.message; }
    };
    m.onclick = async ev => {
      const t = ev.target;
      if (t === m || t.closest("[data-x]")) { clearTimeout(dlPoll); return m.remove(); }
      if (t.id === "dl-go") {
        const kinds = [...m.querySelectorAll("[data-kind]:checked")].map(x => x.dataset.kind); if (kinds.includes("image")) kinds.push("gallery");
        try {
          await api("/api/media/start", { target: $("#dl-t").value, limit: postId ? 1 : Number($("#dl-n").value), sort: postId ? "hot" : $("#dl-s").value,
            t: postId ? "week" : $("#dl-time").value, kinds, nsfw: !!(m.querySelector("#dl-nsfw") || {}).checked });
          poll();
        } catch (err) { $("#dl-st").textContent = err.message; }
      }
      if (t.id === "dl-stop") { await api("/api/media/cancel", {}); poll(); }
      if (t.id === "dl-open") { try { await api("/api/media/open", {}); } catch (err) { say(err.message); } }
    };
    poll();
  }

  /* ---------------- wiring ---------------- */
  document.addEventListener("rs:feed", () => {
    buildSelector();
    const want = viewFor(target());
    if (IMMERSIVE.includes(want)) {
      if (!document.documentElement.className.match(/\bv-/)) applyInline("split");
      if (!rv && feed.posts.length && autoOpened !== target()) { autoOpened = target(); view = want; syncSelect(); setTimeout(() => openImmersive(want), 50); }
    } else { view = want; applyInline(want === "smart" ? smartPick() : want); syncSelect(); }
    if (currentInline() === "masonry") naturalThumbs();
    decorateTags(document);
    if (feed.posts.length <= 100) restoreScroll();
  });
  let autoOpened = null;
  document.addEventListener("rs:post", ev => {
    const { p, el } = ev.detail;
    commentTools(p, el);
    decorateTags(el);
    const actions = el.querySelector(".actions");
    if (actions && srcOf(p)) {
      actions.insertAdjacentHTML("beforeend", `<button data-vx="dl">⬇ Download media</button><button data-vx="theater">Theater</button>`);
      actions.addEventListener("click", ev2 => {
        const b = ev2.target.closest("[data-vx]"); if (!b) return;
        if (b.dataset.vx === "dl") download(p.id);
        if (b.dataset.vx === "theater") { if (!feed.posts.some(x => x.id === p.id)) feed.posts.unshift(p); openImmersive("theater", p.id); }
      });
    }
  });
  document.addEventListener("rs:opt", ev => {
    const { id, v } = ev.detail;
    if (id === "focusMode") focus(!!v);
    if (["viewColumns", "aspectLock", "gridMin"].includes(id)) applyInline(currentInline());
  });
  focus(!!opt("focusMode"));
  window.addEventListener("hashchange", () => { if (rv) closeImmersive(); restored = null; autoOpened = null; });
  buildSelector(); hoverPreview(); trackScroll();
  applyInline(view === "smart" || IMMERSIVE.includes(view) ? "split" : view);

  window.RSViews = { MODES, setView, openImmersive, closeImmersive, tagUser, addToFeed, feedsManager, download, get view() { return view; } };
})();
