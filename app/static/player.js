/* Reddit Studio Player: open-source controls for every video and image.
   Video: Plyr (MIT) on top of the browser's own player, with hls.js for Reddit streams.
   Images: PhotoSwipe (MIT) for zoom, pan and swipe galleries. Both are bundled in static/vendor.
   Loaded after views.js. Settings live in Settings › Player. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const opt = id => Studio.opt(id);
  const say = m => (window.toast ? toast(m) : console.log(m));
  const VENDOR = "/static/vendor/";
  for (const href of ["plyr.css", "photoswipe.css"]) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = VENDOR + href; document.head.appendChild(l);
  }
  const css = document.createElement("style");
  css.textContent = `
  .plyr{--plyr-color-main:var(--accent);--plyr-video-background:#000;border-radius:inherit;height:100%}
  .media .plyr{max-height:var(--rs-media-h,72vh)}
  .media .plyr video{max-height:var(--rs-media-h,72vh)}
  #rv .plyr{max-width:100%;max-height:100vh;width:100%}
  #rv .plyr video{max-height:100vh}
  .plyr__controls .rs-btn{font:600 11px/1 Inter,system-ui,sans-serif;min-width:30px;justify-content:center}
  .plyr__controls .rs-btn[aria-pressed=true]{background:var(--plyr-color-main);color:#fff}
  .pswp{--pswp-bg:#000}
  .pswp__custom-caption{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);max-width:80vw;color:#fff;background:rgba(0,0,0,.55);padding:6px 12px;border-radius:8px;font-size:13px}
  .rs-zoomable{cursor:zoom-in}`;
  document.head.appendChild(css);

  let plyrReady = null;
  function loadPlyr() {
    if (window.Plyr) return Promise.resolve();
    if (!plyrReady) plyrReady = new Promise((ok, bad) => { const s = document.createElement("script"); s.src = VENDOR + "plyr.min.js"; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
    return plyrReady;
  }
  let pswpMod = null;
  const loadPswp = () => (pswpMod = pswpMod || import(VENDOR + "photoswipe.esm.min.js").then(m => m.default));

  /* ---------------- video ---------------- */
  const live = new Set();
  async function enhance(video, o = {}) {
    if (!opt("studioPlayer") || !video || video._plyr || video.closest(".plyr")) return null;
    try { await loadPlyr(); } catch { return null; }
    if (!video.isConnected) return null;
    const step = Number(opt("seekStep")) || 10;
    const controls = o.compact
      ? ["play", "progress", "current-time", "mute", "settings", "pip", "fullscreen"]
      : ["play-large", "rewind", "play", "fast-forward", "progress", "current-time", "duration", "mute", "volume", "settings", "pip", "airplay", "fullscreen"];
    const p = new Plyr(video, {
      controls, settings: ["speed"], seekTime: step, iconUrl: VENDOR + "plyr.svg", loadSprite: true,
      blankVideo: "data:video/mp4;base64,", speed: { selected: Number(opt("speed")) || 1, options: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3] },
      keyboard: { focused: true, global: false }, tooltips: { controls: true, seek: true }, invertTime: false,
      storage: { enabled: !!opt("rememberVolume"), key: "rs_player" }, fullscreen: { enabled: true, iosNative: true },
      loop: { active: !!(opt("loopVideos") || video.loop) }, muted: video.muted, autoplay: video.autoplay,
      clickToPlay: true, hideControls: true, resetOnEnd: false, ratio: null,
    });
    video._plyr = p; live.add(p);
    p.on("ready", () => {
      const bar = p.elements.container.querySelector(".plyr__controls"); if (!bar) return;
      const settingsBtn = bar.querySelector('[data-plyr="settings"]');
      const add = (label, title, onClick, pressed) => {
        const b = document.createElement("button"); b.type = "button"; b.className = "plyr__controls__item plyr__control rs-btn";
        b.textContent = label; b.title = title; if (pressed != null) b.setAttribute("aria-pressed", String(!!pressed));
        b.onclick = ev => { ev.stopPropagation(); onClick(b); };
        (settingsBtn ? settingsBtn.parentElement : bar).before(b); return b;
      };
      add("⟲", "Loop (l)", b => { p.loop = !p.loop; video.loop = p.loop; b.setAttribute("aria-pressed", String(p.loop)); say(p.loop ? "Loop on" : "Loop off"); }, p.loop);
      if (!o.compact) {
        add("◂▮", "Back one frame (,)", () => frame(p, -1));
        add("▮▸", "Forward one frame (.)", () => frame(p, 1));
      }
      if (/\/api\/redgifs\//.test(video.currentSrc || video.src || "")) {
        add(/q=sd/.test(video.currentSrc || video.src) ? "SD" : "HD", "Switch RedGIFs quality", b => {
          const t = video.currentTime, playing = !video.paused, sd = b.textContent === "HD";
          const base = (video.currentSrc || video.src).replace(/\?q=sd$/, "");
          video.src = sd ? base + "?q=sd" : base; video.currentTime = t; if (playing) video.play().catch(() => {});
          b.textContent = sd ? "SD" : "HD";
        });
      }
      if (o.download) add("⬇", "Download this video", () => o.download());
    });
    p.on("ratechange", () => { /* Plyr stores speed itself when "remember" is on */ });
    p.elements.container.addEventListener("keydown", ev => {
      if (ev.key === "," || ev.key === ".") { ev.preventDefault(); ev.stopPropagation(); frame(p, ev.key === "." ? 1 : -1); }
      if (ev.key === "l") { ev.preventDefault(); ev.stopPropagation(); p.loop = !p.loop; video.loop = p.loop; say(p.loop ? "Loop on" : "Loop off"); }
    });
    return p;
  }
  function frame(p, dir) { p.pause(); p.currentTime = Math.max(0, p.currentTime + dir / 30); }
  function cleanup() { for (const p of live) { if (!p.elements || !p.elements.container || !p.elements.container.isConnected) { try { p.destroy(); } catch {} live.delete(p); } } }

  /* ---------------- images: PhotoSwipe ---------------- */
  function sizeOf(src) {
    return new Promise(ok => { const im = new Image(); im.onload = () => ok({ w: im.naturalWidth || 1600, h: im.naturalHeight || 1200 }); im.onerror = () => ok({ w: 1600, h: 1200 }); im.src = src; });
  }
  async function zoom(srcs, index = 0, caption = "") {
    if (!opt("zoomViewer")) return false;
    let PhotoSwipe; try { PhotoSwipe = await loadPswp(); } catch { return false; }
    const items = await Promise.all(srcs.map(async src => { const { w, h } = await sizeOf(src); return { src, width: w, height: h }; }));
    const pswp = new PhotoSwipe({
      dataSource: items, index, bgOpacity: 0.96, wheelToZoom: true, secondaryZoomLevel: 2, maxZoomLevel: 6,
      showHideAnimationType: opt("reduceMotion") ? "none" : "zoom", padding: { top: 30, bottom: 50, left: 20, right: 20 },
      closeTitle: "Close (Esc)", zoomTitle: "Zoom (z)", arrowPrevTitle: "Previous", arrowNextTitle: "Next",
    });
    pswp.on("uiRegister", () => {
      pswp.ui.registerElement({ name: "rs-download", order: 8, isButton: true, tagName: "a", title: "Open full size",
        html: '<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" class="pswp__icn"><path d="M16 8v12m0 0l-5-5m5 5l5-5M9 24h14" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>',
        onInit: (el, ps) => { el.target = "_blank"; el.rel = "noopener"; ps.on("change", () => (el.href = ps.currSlide.data.src)); } });
      pswp.ui.registerElement({ name: "rs-rotate", order: 9, isButton: true, title: "Rotate (r)",
        html: '<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" class="pswp__icn"><path d="M22 10a8 8 0 1 0 2 6M22 4v6h-6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>',
        onClick: (ev, el, ps) => rotate(ps) });
      if (caption) pswp.ui.registerElement({ name: "rs-caption", order: 9, isButton: false, appendTo: "root", onInit: el => { el.className = "pswp__custom-caption"; el.textContent = caption; } });
    });
    const rot = new Map();
    function rotate(ps) { const s = ps.currSlide; const r = ((rot.get(s.index) || 0) + 90) % 360; rot.set(s.index, r); s.container.style.transform = `rotate(${r}deg)`; s.container.style.transformOrigin = "center"; }
    pswp.on("change", () => { const s = pswp.currSlide; if (s) s.container.style.transform = rot.get(s.index) ? `rotate(${rot.get(s.index)}deg)` : ""; });
    pswp.on("keydown", e => { if (e.originalEvent.key === "r") { e.preventDefault(); rotate(pswp); } });
    pswp.init();
    return true;
  }
  function wireImages(root, caption) {
    const imgs = [...root.querySelectorAll(".media img, .stage img")].filter(i => !i.closest(".linkcard"));
    if (!imgs.length) return;
    imgs.forEach((img, n) => {
      img.classList.add("rs-zoomable");
      img.addEventListener("click", ev => {
        if (!opt("zoomViewer") || img.classList.contains("blurred") || img.closest(".media, .stage").querySelector(".reveal, .rev")) return;
        ev.stopImmediatePropagation(); ev.preventDefault();
        zoom(imgs.map(i => i.currentSrc || i.src), n, caption);
      }, true);
    });
  }

  /* ---------------- hooks ---------------- */
  document.addEventListener("rs:post", ev => {
    const { p, el } = ev.detail;
    cleanup();
    const v = el.querySelector(".media video");
    if (v) enhance(v, { download: window.RSViews ? () => RSViews.download(p.id) : null });
    wireImages(el, p.title);
  });
  // immersive views (Gallery, Reels, Theater) — enhance what's on screen
  const mo = new MutationObserver(() => {
    const rv = document.getElementById("rv"); if (!rv) { if (live.size) cleanup(); return; }
    if (opt("playerImmersive")) rv.querySelectorAll("video:not([data-rs-seen])").forEach(v => { v.dataset.rsSeen = "1"; enhance(v, { compact: rv.classList.contains("reels") }); });
    if (rv.querySelector(".stage img:not(.rs-zoomable)")) wireImages(rv, "");
    cleanup();
  });
  mo.observe(document.body, { childList: true, subtree: true });
  document.documentElement.style.setProperty("--rs-media-h", (Number(opt("mediaMaxH")) || 72) + "vh");
  document.addEventListener("rs:opt", ev => { if (ev.detail.id === "mediaMaxH") document.documentElement.style.setProperty("--rs-media-h", ev.detail.v + "vh"); });

  window.StudioPlayer = { enhance, zoom, players: live };
})();
