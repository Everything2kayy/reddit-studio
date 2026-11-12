// ==UserScript==
// @name         Feed Studio (Reddit + X)
// @namespace    local.feedstudio
// @version      1.0.1
// @description  Recolor, resize, and download videos on Reddit and X; 33 toggleable tweaks
// @match        https://www.reddit.com/*
// @match        https://x.com/*
// @match        https://twitter.com/*
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      v.redd.it
// @connect      video.twimg.com
// ==/UserScript==

(function () {
  'use strict';

  const SITE = location.hostname.includes('reddit') ? 'reddit' : 'x';

  // ---------- Settings ----------
  const DEFAULTS = { bg: '#111111', text: '#e6e6e6', accent: '#4fc3f7', vidWidth: 640, tweaks: {} };
  const S = Object.assign({}, DEFAULTS, GM_getValue('settings', {}));
  S.tweaks = S.tweaks || {};
  const save = () => GM_setValue('settings', S);

  // ---------- Developer tweaks (sites: 'reddit' | 'x' | 'both') ----------
  const TWEAKS = [
    // Layout and clutter
    { id: 'hide-sidebar',   label: 'Hide sidebars', sites: 'reddit', css: `aside{display:none!important}` },
    { id: 'hide-promoted',  label: 'Hide promoted posts', sites: 'both', css: `shreddit-post[promoted],[data-testid="placementTracking"],[data-promoted="true"]{display:none!important}` },
    { id: 'hide-trends',    label: 'Hide trends', sites: 'x', css: `[aria-label="Timeline: Trending now"]{display:none!important}` },
    { id: 'hide-wtf',       label: 'Hide "Who to follow"', sites: 'x', css: `[aria-label="Who to follow"]{display:none!important}` },
    { id: 'hide-explore',   label: 'Hide Explore tab', sites: 'x', css: `[href="/explore"]{display:none!important}` },
    { id: 'narrow-x',       label: 'Narrow X column (600px)', sites: 'x', css: `[data-testid="primaryColumn"]{max-width:600px!important}` },
    { id: 'wide-content',   label: 'Full-width content', sites: 'both', css: `main,[role="main"]{max-width:100%!important}` },
    { id: 'hide-subicons',  label: 'Hide subreddit icons', sites: 'reddit', css: `shreddit-subreddit-icon{display:none!important}` },
    { id: 'hide-avatars',   label: 'Hide avatars', sites: 'both', css: `[data-testid^="UserAvatar"]{display:none!important}` },
    { id: 'hide-counts',    label: 'Hide vote and like counts', sites: 'both', css: `faceplate-number,[data-testid="like"] span,[data-testid="retweet"] span{visibility:hidden!important}` },
    { id: 'hide-views',     label: 'Hide view counts', sites: 'x', css: `a[href$="/analytics"]{display:none!important}` },
    { id: 'hide-times',     label: 'Hide timestamps', sites: 'both', css: `time{visibility:hidden!important}` },
    { id: 'hide-awards',    label: 'Hide award buttons', sites: 'reddit', css: `[aria-label*="award" i]{display:none!important}` },
    { id: 'blur-nsfw',      label: 'Blur NSFW thumbnails', sites: 'reddit', css: `shreddit-post[nsfw] img{filter:blur(18px)!important}` },
    // Look and feel
    { id: 'mono-comments',  label: 'Monospace comments', sites: 'reddit', css: `shreddit-comment{font-family:ui-monospace,Menlo,monospace!important}` },
    { id: 'serif-body',     label: 'Serif body text', sites: 'both', css: `body{font-family:Georgia,"Times New Roman",serif!important}` },
    { id: 'bigger-text',    label: 'Bigger text (115%)', sites: 'both', css: `html{font-size:115%!important}` },
    { id: 'underline',      label: 'Underline all links', sites: 'both', css: `a{text-decoration:underline!important}` },
    { id: 'grayscale',      label: 'Grayscale images and video', sites: 'both', css: `img,video{filter:grayscale(1)!important}img:hover,video:hover{filter:none!important}` },
    { id: 'invert',         label: 'Invert colors (smart)', sites: 'both', css: `html{filter:invert(1) hue-rotate(180deg)}img,video{filter:invert(1) hue-rotate(180deg)}` },
    { id: 'no-motion',      label: 'Reduce motion', sites: 'both', css: `*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}` },
    { id: 'no-scrollbar',   label: 'Hide scrollbars', sites: 'both', css: `html{scrollbar-width:none}::-webkit-scrollbar{display:none}` },
    { id: 'compact',        label: 'Compact post spacing', sites: 'reddit', css: `shreddit-post{padding-block:4px!important}` },
    // Developer
    { id: 'dev-outline',    label: 'Outline every element', sites: 'both', css: `*{outline:1px solid rgba(255,0,0,.15)!important}` },
    { id: 'dev-testids',    label: 'Hover shows data-testid', sites: 'x', css: `[data-testid]:hover{outline:2px dashed #0af!important}` },
    { id: 'dev-focus',      label: 'Strong focus rings', sites: 'both', css: `:focus-visible{outline:3px solid var(--fs-accent)!important;outline-offset:2px}` },
    { id: 'dev-link-hover', label: 'Highlight links on hover', sites: 'both', css: `a:hover{background:rgba(127,127,127,.25)!important}` },
    { id: 'dev-tables',     label: 'Scrollable wide tables', sites: 'both', css: `table{display:block;overflow:auto;max-width:100%}` },
    { id: 'dev-mono-all',   label: 'Monospace everything', sites: 'both', css: `body,body *{font-family:ui-monospace,Menlo,monospace!important}` },
    { id: 'dev-no-images',  label: 'Hide all images', sites: 'both', css: `img{display:none!important}` },
    { id: 'dev-wrap-code',  label: 'Wrap code blocks', sites: 'both', css: `pre{white-space:pre-wrap!important;word-break:break-word}` },
    { id: 'dev-select',     label: 'Allow text selection', sites: 'both', css: `*{user-select:text!important}` },
    { id: 'dev-cursor',     label: 'Pointer cursor on buttons', sites: 'both', css: `button,[role="button"],a{cursor:pointer!important}` },
    { id: 'dev-banners',    label: 'Hide login and cookie banners', sites: 'both', css: `[data-testid="BottomBar"],[aria-label*="cookie" i],shreddit-dialog-bottom-bar{display:none!important}` },
  ].filter((t) => t.sites === 'both' || t.sites === SITE);

  // ---------- Theme and tweak CSS ----------
  const styleEl = document.createElement('style');
  styleEl.id = 'fs-style';
  (document.head || document.documentElement).appendChild(styleEl);

  function applyCSS() {
    let css = `
      :root { --fs-bg:${S.bg}; --fs-text:${S.text}; --fs-accent:${S.accent}; --fs-vid:${S.vidWidth}px; }
      html, body { background:${S.bg} !important; color:${S.text} !important; }
      a { color:${S.accent}; }
      video, shreddit-player, [data-testid="videoPlayer"] {
        width:var(--fs-vid) !important; max-width:100% !important; height:auto !important;
      }`;
    for (const t of TWEAKS) if (S.tweaks[t.id]) css += '\n' + t.css;
    styleEl.textContent = css;
  }

  GM_addStyle(`
    #fs-btn { position:fixed; right:16px; bottom:16px; z-index:999999; width:42px; height:42px;
      border-radius:50%; border:0; background:var(--fs-accent,#4fc3f7); color:#000; font-size:20px; cursor:pointer; }
    #fs-panel { position:fixed; right:16px; bottom:70px; width:300px; max-height:70vh; overflow:auto;
      z-index:999999; background:#1b1b1b; color:#eee; border:1px solid #444; border-radius:12px;
      padding:14px; font:13px system-ui,sans-serif; display:grid; gap:8px; }
    #fs-panel[hidden] { display:none; }
    #fs-panel label { display:flex; align-items:center; gap:6px; }
    #fs-panel h3 { margin:0; font-size:15px; }
    #fs-panel button { padding:6px; cursor:pointer; }
    #fs-tweaks { display:grid; gap:6px; border-top:1px solid #444; padding-top:8px; }
  `);

  // ---------- Video download ----------
  let hovered = null;
  document.addEventListener('mouseover', (e) => {
    const v = e.composedPath().find((n) => n.tagName === 'VIDEO');
    if (v) hovered = v;
  }, true);

  function downloadVideo() {
    const v = hovered || document.querySelector('video');
    if (!v) return alert('No video found. Hover over one first.');
    const url = v.currentSrc || v.src || v.querySelector('source')?.src;
    if (!url || url.startsWith('blob:')) {
      return alert("This video streams as a blob and can't be downloaded directly. Use yt-dlp for it (see notes).");
    }
    GM_xmlhttpRequest({
      method: 'GET',
      url,
      responseType: 'blob',
      onload: (r) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(r.response);
        a.download = url.split('/').pop().split('?')[0] || 'video.mp4';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      },
      onerror: () => alert('Download failed.'),
    });
  }

  // ---------- Settings panel ----------
  let panel;
  function buildPanel() {
    const btn = document.createElement('button');
    btn.id = 'fs-btn';
    btn.title = 'Feed Studio (Alt+S)';
    btn.textContent = '⚙';

    panel = document.createElement('div');
    panel.id = 'fs-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <h3>Feed Studio</h3>
      <label>Background <input type="color" data-k="bg" value="${S.bg}"></label>
      <label>Text <input type="color" data-k="text" value="${S.text}"></label>
      <label>Accent <input type="color" data-k="accent" value="${S.accent}"></label>
      <label>Video width <input type="range" min="280" max="1400" step="10" data-k="vidWidth" value="${S.vidWidth}">
        <span id="fs-vw">${S.vidWidth}px</span></label>
      <button id="fs-dl">Download hovered video (Alt+D)</button>
      <div id="fs-tweaks"></div>`;

    const list = panel.querySelector('#fs-tweaks');
    for (const t of TWEAKS) {
      const l = document.createElement('label');
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = !!S.tweaks[t.id];
      c.addEventListener('change', () => {
        S.tweaks[t.id] = c.checked;
        save();
        applyCSS();
      });
      l.append(c, ' ' + t.label);
      list.appendChild(l);
    }

    panel.querySelectorAll('[data-k]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k;
        S[k] = k === 'vidWidth' ? Number(inp.value) : inp.value;
        if (k === 'vidWidth') panel.querySelector('#fs-vw').textContent = inp.value + 'px';
        save();
        applyCSS();
      });
    });

    panel.querySelector('#fs-dl').addEventListener('click', downloadVideo);
    btn.addEventListener('click', () => (panel.hidden = !panel.hidden));
    document.body.append(btn, panel);
  }

  // ---------- Shortcuts and menu ----------
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.code === 'KeyD') { e.preventDefault(); downloadVideo(); }
    if (e.code === 'KeyS') { e.preventDefault(); if (panel) panel.hidden = !panel.hidden; }
  });
  GM_registerMenuCommand('Open Feed Studio', () => panel && (panel.hidden = !panel.hidden));

  // ---------- Init ----------
  applyCSS();
  buildPanel();
})();
