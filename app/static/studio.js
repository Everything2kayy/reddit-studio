/* Reddit Studio: settings engine, themes, explicit mode, bookmarks, menus, palette, mods.
   Loaded in <head> before the main script: the "early" part runs right away (start page,
   default sort/layout); the rest wires up once the page has loaded. Read-only toward Reddit. */
(function () {
  "use strict";
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  // the main page's top-level const/let values aren't window properties; read them by name, safely
  const G = {
    feed: () => (typeof feed !== "undefined" ? feed : null),
    settings: () => (typeof settings !== "undefined" ? settings : null),
    account: () => (typeof account !== "undefined" ? account : {}),
    openId: () => (typeof openId !== "undefined" ? openId : null),
    tools: () => (typeof tools !== "undefined" ? tools : []),
    isAdult: p => (typeof isAdult !== "undefined" ? isAdult(p) : !!p.nsfw),
  };
  const DEFAULT_EXPLICIT = ["nsfw", "NSFW_GIF", "nsfw_gifs", "RealGirls", "gonewild", "Amateur", "porn", "holdthemoan", "NSFW_HTML5", "OnOff"];

  /* ---------------- extra themes ---------------- */
  const THEMES = {
    dracula: ["Dracula", "#282a36", "#2f3241", "#383b4d", "#f8f8f2", "#a4a9c9", "#44475a", "#bd93f9"],
    solardark: ["Solarized dark", "#002b36", "#073642", "#0b404e", "#eee8d5", "#93a1a1", "#174652", "#b58900"],
    solarlight: ["Solarized light", "#fdf6e3", "#fffaf0", "#eee8d5", "#3b4b52", "#657b83", "#e4dcc4", "#268bd2"],
    gruvbox: ["Gruvbox", "#282828", "#32302f", "#3c3836", "#ebdbb2", "#a89984", "#504945", "#fe8019"],
    monokai: ["Monokai", "#272822", "#2f302a", "#3a3b33", "#f8f8f2", "#a6a28c", "#49483e", "#a6e22e"],
    oled: ["OLED black", "#000000", "#0a0a0a", "#141414", "#f2f2f2", "#9a9a9a", "#1f1f1f", "#3ea6ff"],
    ocean: ["Ocean", "#0b1d2a", "#10293b", "#16344b", "#e3f2ff", "#8fb3cc", "#1e415c", "#38bdf8"],
    forest: ["Forest", "#0f1a14", "#15241b", "#1b2e22", "#e4f2e7", "#8fb39a", "#24402e", "#4ade80"],
    rose: ["Rosé", "#1f1418", "#2a1b21", "#33212a", "#fbe7ee", "#c99aab", "#432a35", "#fb7185"],
    coffee: ["Coffee", "#1e1813", "#28201a", "#322820", "#f2e6d9", "#b8a28c", "#3f3226", "#d4a373"],
    cyber: ["Cyberpunk", "#0d0221", "#150535", "#1d0a45", "#e8f9ff", "#9aa8ff", "#2a1260", "#f9f002"],
    paper: ["Paper", "#ffffff", "#ffffff", "#f6f6f6", "#111111", "#666666", "#e6e6e6", "#111111"],
    amber: ["Amber terminal", "#0c0800", "#151000", "#1e1700", "#ffcc66", "#b38f40", "#2e2300", "#ffb000"],
    lavender: ["Lavender", "#f5f3ff", "#ffffff", "#ede9fe", "#2e1065", "#6d5aa8", "#ddd6fe", "#7c3aed"],
  };
  let themeCSS = "";
  for (const [id, [, bg, panel, panel2, text, muted, border, accent]] of Object.entries(THEMES))
    themeCSS += `[data-theme=${id}]{--bg:${bg};--panel:${panel};--panel2:${panel2};--text:${text};--muted:${muted};--border:${border};--accent:${accent}}\n`;

  /* ---------------- option registry ---------------- */
  // type: toggle | range | select | text | area | button
  const CATS = ["Appearance", "Views", "Player", "Feed", "Media", "Comments", "Explicit mode", "Privacy", "Network", "Storage", "Keyboard", "Developer", "Mods", "Setup"];
  const O = [];
  const add = (cat, id, label, type, def, extra = {}) => O.push({ cat, id, label, type, def, ...extra });

  // Appearance
  add("Appearance", "fontSize", "Text size", "range", 14, { min: 12, max: 19, step: 1, unit: "px" });
  add("Appearance", "fontFamily", "Font", "select", "inter", { options: [["inter", "Inter (default)"], ["system", "System"], ["serif", "Serif"], ["mono", "Monospace"], ["rounded", "Rounded"]] });
  add("Appearance", "lineHeight", "Line spacing", "range", 1.5, { min: 1.2, max: 2, step: 0.05 });
  add("Appearance", "radius", "Corner roundness", "range", 12, { min: 0, max: 22, step: 1, unit: "px" });
  add("Appearance", "density", "Card spacing", "select", "normal", { options: [["compact", "Compact"], ["normal", "Normal"], ["spacious", "Spacious"]] });
  add("Appearance", "thumbSize", "Thumbnail size (list)", "range", 76, { min: 44, max: 150, step: 2, unit: "px" });
  add("Appearance", "gridMin", "Grid card width", "range", 180, { min: 130, max: 380, step: 10, unit: "px" });
  add("Appearance", "feedWidth", "Feed column width (list)", "range", 440, { min: 300, max: 760, step: 10, unit: "px" });
  add("Appearance", "boldTitles", "Bold post titles", "toggle", false);
  add("Appearance", "bgPattern", "Background pattern", "select", "none", { options: [["none", "None"], ["dots", "Dots"], ["grid", "Grid"], ["glow", "Accent glow"]] });
  add("Appearance", "compactHeader", "Compact top bar", "toggle", false);
  add("Appearance", "thinScroll", "Thin scrollbars", "toggle", true);
  add("Appearance", "reduceMotion", "Reduce motion", "toggle", false);
  add("Appearance", "glowSel", "Glow on the selected post", "toggle", true);
  add("Appearance", "textIcons", "Text labels instead of icons", "toggle", false);
  add("Appearance", "autoTheme", "Follow macOS light/dark", "select", "off", { options: [["off", "Off"], ["on", "Daylight by day, Midnight by night"]] });

  // Views (the feed display engine lives in static/views.js)
  add("Views", "rememberView", "Remember the view for each community", "toggle", true);
  add("Views", "viewColumns", "Columns in Grid, Masonry and Magazine", "select", "auto", { options: [["auto", "Automatic"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"]] });
  add("Views", "aspectLock", "Show whole images in Grid (no cropping)", "toggle", false);
  add("Views", "hoverPreview", "Preview images when hovering a post", "toggle", true);
  add("Views", "smartMedia", "Smart view: media-heavy feeds use", "select", "masonry", { options: [["masonry", "Masonry"], ["grid", "Grid"], ["magazine", "Magazine"]] });
  add("Views", "reelsAdvance", "Reels: move to the next video automatically", "select", "end", { options: [["off", "Off"], ["end", "When a video ends"], ["8", "Every 8 seconds"], ["15", "Every 15 seconds"]] });
  add("Views", "gallerySlideshow", "Gallery slideshow speed", "select", "5", { options: [["3", "3 seconds"], ["5", "5 seconds"], ["8", "8 seconds"], ["12", "12 seconds"]] });
  add("Views", "overlaySound", "Play sound in Reels, Gallery and Theater", "toggle", false);
  add("Views", "overlayReveal", "Show 18+ media unblurred in Reels, Gallery and Theater", "toggle", false);
  add("Views", "resumeScroll", "Resume where you left off in each feed", "toggle", true);
  add("Views", "focusMode", "Focus mode (hide bars; z toggles)", "toggle", false);
  add("Views", "commentTools", "Comment tools (OP only, search, new-comment count)", "toggle", true);

  // Feed
  add("Feed", "showThumbs", "Show thumbnails", "toggle", true);
  add("Feed", "showFlairs", "Show flairs", "toggle", true);
  add("Feed", "showDomain", "Show link domains", "toggle", true);
  add("Feed", "hideScores", "Hide scores and comment counts", "toggle", false);
  add("Feed", "markRead", "Mark posts as read when opened", "toggle", true);
  add("Feed", "dimRead", "Dim posts you've read", "toggle", true);
  add("Feed", "hideRead", "Hide posts you've read", "toggle", false);
  add("Feed", "hidePinned", "Hide pinned posts", "toggle", false);
  add("Feed", "hideDupes", "Hide duplicate links in a feed", "toggle", true);
  add("Feed", "newBadge", "Highlight posts under 1 hour old", "toggle", false);
  add("Feed", "minScore", "Hide posts below this score", "range", 0, { min: 0, max: 2000, step: 10 });
  add("Feed", "muteWords", "Hide posts containing (comma separated)", "text", "");
  add("Feed", "highlightWords", "Highlight posts containing (comma separated)", "text", "");
  add("Feed", "muteSubs", "Muted communities (comma separated)", "text", "");
  add("Feed", "muteUsers", "Muted users (comma separated)", "text", "");
  add("Feed", "infiniteScroll", "Load more automatically when scrolling", "toggle", true);
  add("Feed", "defaultSort", "Default sort", "select", "hot", { options: ["hot", "new", "top", "rising", "controversial"].map(s => [s, s]) });
  add("Feed", "defaultGrid", "Start in grid view", "toggle", false);
  add("Feed", "startPage", "Start page (r/name, u/name, bookmarks, explicit)", "text", "r/popular");
  add("Feed", "rememberLast", "Reopen the last community on start", "toggle", false);

  // Player (static/player.js: Plyr for video, PhotoSwipe for images)
  add("Player", "studioPlayer", "Studio Player controls on videos (speed, loop, skip, frame step)", "toggle", true);
  add("Player", "seekStep", "Skip buttons and arrow keys jump", "select", "10", { options: [["5", "5 seconds"], ["10", "10 seconds"], ["15", "15 seconds"], ["30", "30 seconds"]] });
  add("Player", "rememberVolume", "Remember volume and speed between videos", "toggle", true);
  add("Player", "playerImmersive", "Use the Studio Player in Gallery, Reels and Theater", "toggle", true);
  add("Player", "zoomViewer", "Zoom viewer for images (pinch, scroll, drag, rotate)", "toggle", true);
  add("Player", "playerKeys", "Player shortcuts", "button", null, { run: () => playerKeys() });

  // Media
  add("Media", "autoplay", "Autoplay videos when a post opens", "toggle", false);
  add("Media", "startMuted", "Start videos muted", "toggle", true);
  add("Media", "loopVideos", "Loop videos", "toggle", false);
  add("Media", "speed", "Default playback speed", "select", "1", { options: ["0.5", "0.75", "1", "1.25", "1.5", "2"].map(s => [s, s + "×"]) });
  add("Media", "mediaMaxH", "Max media height", "range", 72, { min: 35, max: 100, step: 1, unit: "% of window" });
  add("Media", "lightbox", "Click media for fullscreen viewer", "toggle", true);
  add("Media", "pipButton", "Picture-in-picture button on videos", "toggle", true);
  add("Media", "redgifsQuality", "RedGIFs quality", "select", "hd", { options: [["hd", "HD"], ["sd", "SD (faster)"]] });
  add("Media", "mediaBg", "Background behind media", "select", "black", { options: [["black", "Black"], ["theme", "Match theme"]] });

  // Comments
  add("Comments", "collapseDepth", "Collapse replies deeper than", "select", "off", { options: [["off", "Never"], ["1", "1 level"], ["2", "2 levels"], ["3", "3 levels"]] });
  add("Comments", "highlightOP", "Highlight the poster's comments", "toggle", true);
  add("Comments", "rainbowLines", "Colored thread lines", "toggle", true);
  add("Comments", "cmtFont", "Comment text size", "range", 14, { min: 12, max: 19, step: 1, unit: "px" });
  add("Comments", "hideAutoMod", "Hide AutoModerator comments", "toggle", false);
  add("Comments", "cmtScores", "Show comment scores", "toggle", true);
  add("Comments", "defaultCsort", "Default comment sort", "select", "top", { options: ["top", "best", "new", "controversial", "old", "qa"].map(s => [s, s]) });

  // Explicit mode
  add("Explicit mode", "explicit", "Explicit mode (18+ only)", "toggle", false, { confirm: "Turn on explicit 18+ mode? Only continue if you are 18 or older." });
  add("Explicit mode", "explicitSubs", "Explicit communities for #/explicit (comma separated)", "text", DEFAULT_EXPLICIT.join(", "));
  add("Explicit mode", "explicitSeparate", "Keep explicit posts out of regular feeds", "toggle", true);
  add("Explicit mode", "blur", "Blur 18+ media until clicked", "toggle", true);
  add("Explicit mode", "hoverReveal", "Reveal blurred media on hover", "toggle", false);
  add("Explicit mode", "explicitGrid", "Use grid view in explicit feeds", "toggle", true);
  add("Explicit mode", "explicitMediaOnly", "Explicit feed shows only images and videos", "toggle", true);
  add("Explicit mode", "explicitTheme", "Theme while in explicit feeds", "select", "", { options: [["", "Keep current"], ["oled", "OLED black"], ["synth", "Synthwave"], ["rose", "Rosé"], ["cyber", "Cyberpunk"]] });
  add("Explicit mode", "explicitAutoplay", "Autoplay explicit videos (muted)", "toggle", true);
  add("Explicit mode", "redgifsTab", "Open RedGIFs videos in the RedGIFs tab (creator, tags, more videos)", "toggle", true);
  add("Explicit mode", "panicKey", "Panic key: ` (backtick) hides everything and jumps to a safe page", "toggle", true);
  add("Explicit mode", "panicPage", "Safe page for the panic key", "text", "r/technology");

  // Privacy
  add("Privacy", "blurOnLeave", "Blur the app when you switch away", "toggle", false);
  add("Privacy", "noRecent", "Don't remember recent communities", "toggle", false);
  add("Privacy", "confirmExternal", "Ask before opening outside links", "toggle", false);
  add("Privacy", "pin", "Lock with a PIN on open (4–8 digits, blank = off)", "text", "");
  add("Privacy", "lockNow", "Lock now", "button", null, { run: () => lock() });
  add("Privacy", "clearRecent", "Clear recent communities", "button", null, { run: () => { LS.set("rs_recent", []); window.renderChips && renderChips(); say("Cleared"); } });
  add("Privacy", "clearRead", "Clear read history", "button", null, { run: () => { LS.set("rs_read", []); readSet.clear(); rerender(); say("Cleared"); } });
  add("Privacy", "clearBookmarks", "Delete all bookmarks", "button", null, { run: () => { if (confirm("Delete all bookmarks?")) { LS.set("rs_bm", []); say("Deleted"); } } });

  // Keyboard
  add("Keyboard", "vimKeys", "j / k to move through posts", "toggle", true);
  add("Keyboard", "npKeys", "n / p to open the next / previous post", "toggle", true);
  add("Keyboard", "gotoKeys", "g then p/h/s/e/b/t to jump (popular, home, saved, explicit, bookmarks, tools)", "toggle", true);
  add("Keyboard", "actionKeys", "o opens the link, b bookmarks, m mutes the community", "toggle", true);
  add("Keyboard", "paletteKey", "Cmd/Ctrl+K command palette", "toggle", true);
  add("Keyboard", "showKeys", "Show all shortcuts", "button", null, { run: () => cheatSheet() });

  // Developer
  add("Developer", "sourceBadge", "Show where data comes from (sign-in, Chrome, RSS, archive)", "toggle", false);
  add("Developer", "jsonButton", "\"View JSON\" button on posts", "toggle", false);
  add("Developer", "copyIdButton", "\"Copy ID\" and \"Copy API path\" buttons on posts", "toggle", false);
  add("Developer", "outline", "Outline every element", "toggle", false);
  add("Developer", "logApi", "Log app requests to the browser console", "toggle", false);
  add("Developer", "perfHud", "Show render timings", "toggle", false);
  add("Developer", "customCSS", "Custom CSS (applies live)", "area", "");
  add("Developer", "scriptConsole", "Script console (run JavaScript against the app)", "button", null, { run: () => scriptConsole() });
  add("Developer", "exportSettings", "Export settings", "button", null, { run: () => exportSettings() });
  add("Developer", "importSettings", "Import settings…", "button", null, { run: () => importSettings() });
  add("Developer", "resetSettings", "Reset all settings", "button", null, { run: () => { if (confirm("Reset every setting to default?")) { LS.set("rs_opts", {}); location.reload(); } } });

  const OPT = Object.fromEntries(O.map(o => [o.id, o]));
  let V = Object.assign({}, LS.get("rs_opts", {}));
  // the existing 18+ switches live in rs_adult / rs_blur; keep them in sync
  if (LS.get("rs_adult", false) && V.explicit === undefined) V.explicit = true;
  if (V.blur === undefined) V.blur = LS.get("rs_blur", true);
  const opt = id => (id in V ? V[id] : (OPT[id] ? OPT[id].def : undefined));
  function setOpt(id, v) {
    V[id] = v; LS.set("rs_opts", V);
    if (id === "explicit") { LS.set("rs_adult", !!v); if (G.settings()) G.settings().adult = !!v; window.renderDirectory && renderDirectory(); window.renderChips && renderChips(); }
    if (id === "blur") { LS.set("rs_blur", !!v); if (G.settings()) G.settings().blur = !!v; }
    if (id === "defaultSort") LS.set("rs_sort", v);
    if (id === "defaultCsort") LS.set("rs_csort", v);
    applyAll(); rerender();
    document.dispatchEvent(new CustomEvent("rs:opt", { detail: { id, v } }));
  }

  /* ---------------- early: before the main script reads its saved values ---------------- */
  if (opt("defaultGrid") && LS.get("rs_layout") == null) LS.set("rs_layout", "grid");
  if (LS.get("rs_sort") == null) LS.set("rs_sort", opt("defaultSort"));
  if (!location.hash || location.hash === "#" || location.hash === "#/") {
    let start = opt("startPage") || "r/popular";
    if (opt("rememberLast") && LS.get("rs_last")) start = LS.get("rs_last");
    history.replaceState(null, "", "#/" + start.replace(/^#?\/?/, ""));
  }

  /* ---------------- styles driven by options ---------------- */
  const style = document.createElement("style");
  style.id = "studio-style";
  const FONTS = { inter: 'Inter,system-ui,-apple-system,"Segoe UI",sans-serif', system: 'system-ui,-apple-system,"Segoe UI",sans-serif',
    serif: 'Georgia,"Iowan Old Style","Times New Roman",serif', mono: 'ui-monospace,Menlo,Consolas,monospace', rounded: '"SF Pro Rounded",ui-rounded,"Nunito",system-ui,sans-serif' };
  const STATIC_CSS = `
${themeCSS}
html.o-boldTitles .card h3{font-weight:800}
html.o-compactHeader header{padding:4px 10px;gap:6px}.o-compactHeader .brand .bt{display:none}
.o-thinScroll *{scrollbar-width:thin}.o-thinScroll ::-webkit-scrollbar{width:8px;height:8px}.o-thinScroll ::-webkit-scrollbar-thumb{background:var(--border);border-radius:8px}
.o-reduceMotion *{animation:none!important;transition:none!important;scroll-behavior:auto!important}
.o-glowSel .card.sel{box-shadow:0 0 0 1px var(--accent),0 0 18px color-mix(in srgb,var(--accent) 45%,transparent)}
html.d-compact #feed{gap:4px;padding:4px}html.d-compact .card{padding:6px;gap:8px}.d-compact .card h3{font-size:13px;margin:0 0 2px}
html.d-spacious #feed{gap:14px;padding:14px}html.d-spacious .card{padding:16px}
.bg-dots body{background-image:radial-gradient(var(--border) 1px,transparent 1px);background-size:18px 18px}
.bg-grid body{background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:28px 28px}
.bg-glow body{background-image:radial-gradient(circle at 80% -10%,color-mix(in srgb,var(--accent) 22%,transparent),transparent 55%)}
html.no-showThumbs #feed:not(.grid) .card .th{display:none}
.no-showFlairs .card .flair{display:none}
.no-showDomain .card .dom{display:none}
.o-hideScores .card .meta:last-child>span:not(.flair):not(.dom),.o-hideScores #detail .meta{visibility:hidden}
.o-dimRead .card.read{opacity:.5}.o-dimRead .card.read:hover{opacity:.85}
html .card.hl{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--panel))}
.card.fresh h3::before{content:"NEW ";color:var(--accent);font-size:11px;font-weight:800}
.card.bm h3::after{content:" 🔖";font-size:12px}
html.o-highlightOP .cmt .ch .op{background:var(--accent);color:var(--bg);border-radius:5px;padding:0 5px}
.no-rainbowLines .cmt{border-left-color:var(--border)!important}
.o-hideAutoMod .cmt[data-author=AutoModerator]{display:none}
.no-cmtScores .cmt .ch>span:has(.ms){display:none}
html.o-hoverReveal .media:hover .blurred,.o-hoverReveal .card:hover .th.blurred{filter:none}
.o-hoverReveal .media:hover .reveal{opacity:0;pointer-events:none}
html.mbg-theme .media,.mbg-theme .media img,.mbg-theme .media video,.mbg-theme .gallery{background:var(--panel2)}
.o-outline *{outline:1px solid rgba(255,80,80,.18)}
.blurall body>*:not(#lockscreen){filter:blur(28px)!important}
#srcbadge{font-size:11px;border:1px solid var(--border);border-radius:6px;padding:0 6px;color:var(--muted)}
#perfhud{position:fixed;left:8px;bottom:8px;z-index:90;background:#000c;color:#7dff9b;font:11px ui-monospace,monospace;padding:4px 8px;border-radius:6px;pointer-events:none}
.pipbtn{position:absolute;top:8px;right:8px;z-index:3;background:rgba(0,0,0,.65);color:#fff;border:0}
/* settings */
#setmodal .modal{width:min(880px,100%);padding:0;display:flex;flex-direction:column;max-height:calc(100vh - 32px);overflow:hidden}
.sethead{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--border)}
.sethead input{flex:1}
.setbody{display:flex;min-height:0;flex:1}
.setnav{width:180px;flex:none;border-right:1px solid var(--border);overflow:auto;padding:8px}
.setnav button{width:100%;border:0;background:transparent;justify-content:flex-start;padding:7px 10px}
.setnav button.on{background:var(--accent);color:var(--bg);font-weight:600}
.setlist{flex:1;overflow:auto;padding:8px 18px 20px}
.setrow{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--border)}
.setrow .lbl{flex:1;min-width:0}.setrow .lbl small{display:block;color:var(--muted);font-size:11.5px}
.setrow input[type=text]{width:min(320px,45%)}
.setrow textarea{width:100%;min-height:130px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:9px;padding:8px;font:12px/1.45 ui-monospace,Menlo,monospace}
.setrow.col{flex-direction:column;align-items:stretch}
.sw{appearance:none;width:38px;height:22px;border-radius:11px;background:var(--border);position:relative;cursor:pointer;flex:none;padding:0;border:0}
.sw::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s}
.sw:checked{background:var(--accent)}.sw:checked::after{left:19px}
.themegrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin:10px 0}
.themecard{border:2px solid var(--border);border-radius:10px;padding:8px;cursor:pointer;font-size:12px}
.themecard.on{border-color:var(--accent)}
.themecard .sw4{display:flex;gap:3px;margin-bottom:6px}.themecard .sw4 i{flex:1;height:18px;border-radius:4px}
.presets{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 14px}
.modrow{border:1px solid var(--border);border-radius:10px;padding:10px;margin:8px 0}
.modrow .mh{display:flex;gap:8px;align-items:center}.modrow .mh b{flex:1}
/* context menu, palette, lightbox, lock */
#ctx{position:fixed;z-index:120;min-width:220px;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:6px;box-shadow:0 12px 40px rgba(0,0,0,.45)}
#ctx button{width:100%;border:0;background:transparent;justify-content:flex-start;padding:7px 10px}
#ctx button:hover{background:var(--panel2)}
#ctx hr{border:0;border-top:1px solid var(--border);margin:4px 0}
#palette{position:fixed;inset:0;z-index:130;background:rgba(0,0,0,.45);display:flex;justify-content:center;align-items:flex-start;padding-top:12vh}
#palette .pbox{width:min(620px,92vw);background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.5);overflow:hidden}
#palette input{width:100%;border:0;border-bottom:1px solid var(--border);border-radius:0;padding:14px 16px;font-size:16px;background:var(--panel)}
#palette input:focus{outline:none}
#palette .plist{max-height:50vh;overflow:auto;padding:6px}
#palette .pi{display:flex;gap:10px;align-items:center;padding:8px 10px;border-radius:8px;cursor:pointer}
#palette .pi small{color:var(--muted);margin-left:auto;font-size:11px}
#palette .pi.on{background:var(--accent);color:var(--bg)}#palette .pi.on small{color:var(--bg)}
#lightbox{position:fixed;inset:0;z-index:140;background:rgba(0,0,0,.94);display:grid;place-items:center}
#lightbox img,#lightbox video{max-width:96vw;max-height:92vh;object-fit:contain}
#lightbox .lbx{position:absolute;top:12px;right:12px;background:rgba(255,255,255,.12);color:#fff;border:0}
#lightbox .lbn{position:absolute;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.12);color:#fff;border:0;font-size:22px;padding:10px 14px}
#lightbox .lbc{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);color:#ccc;font-size:12px}
#lockscreen{position:fixed;inset:0;z-index:200;background:var(--bg);display:grid;place-items:center}
#lockscreen .lk{display:grid;gap:10px;justify-items:center}
#lockscreen input{font-size:22px;text-align:center;letter-spacing:.4em;width:200px}
.kbd{font:12px ui-monospace,monospace;border:1px solid var(--border);border-bottom-width:2px;border-radius:5px;padding:1px 6px;background:var(--panel2)}
`;
  function applyAll() {
    const de = document.documentElement, cl = de.classList;
    for (const o of O) {
      if (o.type !== "toggle") continue;
      cl.toggle("o-" + o.id, !!opt(o.id));
      cl.toggle("no-" + o.id, !opt(o.id));
    }
    ["d-compact", "d-normal", "d-spacious"].forEach(c => cl.remove(c)); cl.add("d-" + opt("density"));
    ["bg-none", "bg-dots", "bg-grid", "bg-glow"].forEach(c => cl.remove(c)); cl.add("bg-" + opt("bgPattern"));
    cl.toggle("mbg-theme", opt("mediaBg") === "theme");
    cl.toggle("icons-off", !!opt("textIcons") || cl.contains("icons-off") && !cl.contains("icons-ok"));
    const r = opt("radius"), mh = opt("mediaMaxH");
    style.textContent = STATIC_CSS + `
html body{font-size:${opt("fontSize")}px;line-height:${opt("lineHeight")};font-family:${FONTS[opt("fontFamily")] || FONTS.inter}}
html .card,html .tcard,.media,.linkcard,.modal{border-radius:${r}px}html .card .th{border-radius:${Math.max(0, r - 3)}px}
html #feed:not(.grid) .card .th{flex-basis:${opt("thumbSize")}px;height:${opt("thumbSize")}px}
html #feed.grid{grid-template-columns:repeat(auto-fill,minmax(${opt("gridMin")}px,1fr))}
html .cols:not(.wide){grid-template-columns:minmax(300px,${opt("feedWidth")}px) 1fr}
html .media img,html .media video{max-height:${mh}vh}
html #comments .cbody{font-size:${opt("cmtFont")}px}
${opt("customCSS") || ""}
${mods().filter(m => m.on && m.type === "css").map(m => m.code).join("\n")}`;
    if (!style.isConnected) document.head.appendChild(style);
  }
  applyAll();

  /* ---------------- state used by hooks ---------------- */
  const readSet = new Set(LS.get("rs_read", []));
  const listOf = s => String(s || "").split(",").map(x => x.trim().toLowerCase().replace(/^\/?(r|u)\//, "")).filter(Boolean);
  const explicitSubs = () => listOf(opt("explicitSubs"));
  const bookmarks = () => LS.get("rs_bm", []);
  const isBookmarked = id => bookmarks().some(b => b.id === id);
  let seenUrls = new Map();
  function inExplicit() {
    const feed = G.feed(); if (!feed) return false;
    if (feed.target === "explicit") return true;
    const m = /^r\/(.+)$/.exec(feed.target || ""); if (!m) return false;
    const subs = m[1].toLowerCase().split("+"), ex = new Set(explicitSubs());
    return subs.length > 0 && subs.every(s => ex.has(s));
  }
  const adult = p => G.isAdult(p);

  function filterPost(p) {
    if (opt("hideRead") && readSet.has(p.id) && p.id !== G.openId()) return false;
    if (opt("hidePinned") && p.stickied) return false;
    if (opt("minScore") > 0 && p.score != null && p.score < opt("minScore")) return false;
    const subs = listOf(opt("muteSubs")), users = listOf(opt("muteUsers"));
    if (subs.includes(String(p.subreddit).toLowerCase()) || users.includes(String(p.author).toLowerCase())) return false;
    const words = listOf(opt("muteWords")), text = (p.title + " " + (p.flair || "")).toLowerCase();
    if (words.some(w => text.includes(w))) return false;
    if (adult(p)) {
      if (!opt("explicit")) return false;
      const t = (G.feed() || {}).target || "";
      if (opt("explicitSeparate") && !inExplicit() && !/^(u\/|bookmarks$)/.test(t) && !explicitTargetOk()) return false;
    }
    if (inExplicit() && opt("explicitMediaOnly") && !["image", "gallery", "video"].includes(p.media && p.media.type)) return false;
    if (opt("hideDupes") && p.media && p.media.link && !/reddit\.com/.test(p.domain)) {
      const first = seenUrls.get(p.media.link);
      if (first && first !== p.id) return false;
      seenUrls.set(p.media.link, p.id);
    }
    return true;
  }
  // a single explicit community opened directly (e.g. r/nsfw) is allowed even with "keep separate"
  function explicitTargetOk() {
    const feed = G.feed() || { posts: [] };
    const m = /^r\/([A-Za-z0-9_]+)$/.exec(feed.target || "");
    return !!m && (explicitSubs().includes(m[1].toLowerCase()) || (feed.posts.length && feed.posts.filter(adult).length / feed.posts.length > 0.6));
  }
  function cardClass(p) {
    const c = [];
    if (readSet.has(p.id)) c.push("read");
    if (opt("newBadge") && Date.now() / 1000 - p.created_utc < 3600) c.push("fresh");
    const hw = listOf(opt("highlightWords"));
    if (hw.length && hw.some(w => p.title.toLowerCase().includes(w))) c.push("hl");
    if (isBookmarked(p.id)) c.push("bm");
    return c.join(" ");
  }
  function rerender() { const feed = G.feed(); if (feed && feed.loaded && window.renderFeed) { seenUrls = new Map(); renderFeed(); } }

  /* ---------------- routes: #/explicit, #/bookmarks ---------------- */
  let themeBefore = null, customFeed = null;
  function route(h) {
    if (h === "redgifs" || h.startsWith("redgifs/")) return window.RSRedgifs ? RSRedgifs.route(h) : true;   // not loaded yet: it routes itself on load
    if (h.startsWith("comments/")) return false;          // opening a post keeps the current look
    if (h === "explicit") {
      if (!opt("explicit")) { openSettings("Explicit mode"); say("Turn on Explicit mode first"); history.replaceState(null, "", "#/r/popular"); return false; }
      const subs = explicitSubs(); if (!subs.length) { openSettings("Explicit mode"); return true; }
      enterExplicitLook();
      loadFeed("r/" + subs.join("+"));
      return true;
    }
    leaveExplicitLook();
    if (h === "bookmarks") { showLocal("🔖 Bookmarks", bookmarks()); return true; }
    if (h === "history") { showLocal("🕘 History", LS.get("rs_hist", [])); return true; }
    let m;
    if ((m = /^c\/(.+)$/.exec(h))) { const c = LS.get("rs_coll", {})[m[1]] || []; showLocal("🗂 " + m[1], c); return true; }
    if ((m = /^f\/(.+)$/.exec(h))) {
      const subs = (LS.get("rs_feeds", {})[m[1]] || []).filter(Boolean);
      if (!subs.length) { say("That custom feed is empty"); return false; }
      customFeed = { name: m[1], target: "r/" + subs.join("+").toLowerCase() };
      loadFeed("r/" + subs.join("+"));
      return true;
    }
    return false;
  }
  function enterExplicitLook() {
    if (opt("explicitGrid") && window.setLayout) setLayout("grid");
    const t = opt("explicitTheme");
    if (t && window.setTheme) { if (themeBefore == null) themeBefore = document.documentElement.dataset.theme; setTheme(t, true); }
  }
  function leaveExplicitLook() {
    if (themeBefore != null && window.setTheme) { setTheme(themeBefore, true); themeBefore = null; }
  }
  function showLocal(title, posts) {
    const feed = G.feed(); if (!feed) return;
    feed.req++; feed.target = "bookmarks"; feed.posts = posts.slice(); feed.after = null; feed.loaded = true; feed.busy = false;
    $("#feedtitle").textContent = title; $("#addr").value = ""; renderChips(); renderFeed();
    if (!posts.length) $("#feed").innerHTML = '<div class="empty">No bookmarks yet. Right-click a post (or press b on an open post) to bookmark it.</div>';
  }
  function toggleBookmark(p) {
    let b = bookmarks();
    if (b.some(x => x.id === p.id)) { b = b.filter(x => x.id !== p.id); say("Bookmark removed"); }
    else { b.unshift(p); say("Bookmarked"); }
    LS.set("rs_bm", b.slice(0, 500)); rerender();
  }
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const say = m => (window.toast ? toast(m) : console.log(m));
  const escH = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const postById = id => (G.feed() && G.feed().posts.find(p => p.id === id)) || bookmarks().find(p => p.id === id) || (current && current.id === id ? current : null);
  let current = null;   // the open post

  /* ---------------- mods: your own CSS/JS snippets ---------------- */
  function mods() { return LS.get("rs_mods", []); }
  function saveMods(m) { LS.set("rs_mods", m); applyAll(); }
  function runJsMods() {
    for (const m of mods().filter(m => m.on && m.type === "js")) {
      try { new Function("Studio", m.code)(window.Studio); } catch (e) { console.warn(`Mod "${m.name}" failed:`, e); say(`Mod "${m.name}" failed: ${e.message}`); }
    }
  }

  /* ---------------- settings window ---------------- */
  let setCat = "Appearance";
  function rowHTML(o) {
    const v = opt(o.id), id = "opt-" + o.id;
    if (o.type === "toggle") return `<label class="setrow"><span class="lbl">${escH(o.label)}</span><input type="checkbox" class="sw" id="${id}" data-o="${o.id}" ${v ? "checked" : ""}></label>`;
    if (o.type === "range") return `<div class="setrow"><span class="lbl">${escH(o.label)}<small>${v}${o.unit ? " " + o.unit : ""}</small></span><input type="range" id="${id}" data-o="${o.id}" min="${o.min}" max="${o.max}" step="${o.step}" value="${v}"></div>`;
    if (o.type === "select") return `<div class="setrow"><span class="lbl">${escH(o.label)}</span><select id="${id}" data-o="${o.id}">${o.options.map(([k, l]) => `<option value="${escH(k)}" ${String(k) === String(v) ? "selected" : ""}>${escH(l)}</option>`).join("")}</select></div>`;
    if (o.type === "text") return `<div class="setrow"><span class="lbl">${escH(o.label)}</span><input type="text" id="${id}" data-o="${o.id}" value="${escH(v)}" spellcheck="false"></div>`;
    if (o.type === "area") return `<div class="setrow col"><span class="lbl">${escH(o.label)}</span><textarea id="${id}" data-o="${o.id}" spellcheck="false" placeholder="/* e.g. .card h3{color:hotpink} */">${escH(v)}</textarea></div>`;
    if (o.type === "button") return `<div class="setrow"><span class="lbl">${escH(o.label)}</span><button data-b="${o.id}">${escH(o.label)}</button></div>`;
    return "";
  }
  const PRESETS = {
    "Reader": { density: "spacious", fontFamily: "serif", fontSize: 16, lineHeight: 1.7, showThumbs: true, boldTitles: false, dimRead: true },
    "Power user": { density: "compact", fontSize: 13, thumbSize: 56, feedWidth: 520, hideDupes: true, newBadge: true, sourceBadge: true, jsonButton: true, copyIdButton: true },
    "Explicit night": { explicitGrid: true, explicitMediaOnly: true, explicitTheme: "oled", hoverReveal: true, explicitAutoplay: true, startMuted: true, panicKey: true, blurOnLeave: true },
    "Accessible": { fontSize: 18, lineHeight: 1.8, reduceMotion: true, textIcons: true, thinScroll: false, radius: 6, cmtFont: 17 },
    "Minimal": { showThumbs: false, showFlairs: false, showDomain: false, hideScores: true, bgPattern: "none", compactHeader: true },
  };
  function setupHTML() {
    const cur = document.documentElement.dataset.theme;
    const builtIn = [["midnight", "Midnight", "#0f1115", "#171a21", "#e7eaf0", "#7aa2ff"], ["daylight", "Daylight", "#f5f6f8", "#fff", "#1b1f27", "#2563eb"],
      ["sepia", "Sepia", "#f4ecd8", "#fbf6e9", "#5b4636", "#9c5b1f"], ["nord", "Nord", "#2e3440", "#3b4252", "#eceff4", "#88c0d0"],
      ["matrix", "Matrix", "#000", "#031a0a", "#7dff9b", "#00ff66"], ["reddit", "Reddit", "#0b1416", "#1a1a1b", "#d7dadc", "#ff4500"],
      ["synth", "Synthwave", "#1a0b2e", "#241240", "#f0e6ff", "#ff4fd8"], ["contrast", "High contrast", "#000", "#000", "#fff", "#ffff00"]];
    const all = [...builtIn, ...Object.entries(THEMES).map(([id, t]) => [id, t[0], t[1], t[2], t[4], t[7]])];
    return `<h3 style="margin:14px 0 4px">Themes (${all.length})</h3><div class="themegrid">${all.map(([id, name, a, b, c, d]) =>
      `<div class="themecard ${id === cur ? "on" : ""}" data-theme-pick="${id}"><div class="sw4"><i style="background:${a}"></i><i style="background:${b}"></i><i style="background:${c}"></i><i style="background:${d}"></i></div>${escH(name)}</div>`).join("")}</div>
      <h3 style="margin:14px 0 4px">Presets</h3><div class="presets">${Object.keys(PRESETS).map(k => `<button data-preset="${escH(k)}">${escH(k)}</button>`).join("")}</div>
      <h3 style="margin:14px 0 4px">Getting set up</h3>
      <div class="setrow"><span class="lbl">Run the setup wizard again</span><button data-wizard>Start</button></div>
      <div class="setrow"><span class="lbl">Sign in, Chrome extension, and fixes<small>Opens the Helper</small></span><button data-helper>Open Helper</button></div>
      <div class="setrow"><span class="lbl">Communities and favorites</span><button data-dir>Open Communities</button></div>`;
  }
  function modsHTML() {
    const ms = mods();
    return `<p class="muted" style="font-size:13px">Mods are your own snippets that change Reddit Studio. CSS mods restyle it; JavaScript mods run when the app opens and get a <code>Studio</code> object (settings, hooks, bookmarks). They run only on this computer.</p>
      ${ms.map((m, i) => `<div class="modrow"><div class="mh"><b>${escH(m.name)}</b><span class="muted" style="font-size:12px">${m.type.toUpperCase()}</span>
        <input type="checkbox" class="sw" data-modon="${i}" ${m.on ? "checked" : ""}><button data-moddel="${i}">Delete</button></div>
        <textarea data-modcode="${i}" spellcheck="false" style="width:100%;min-height:90px;margin-top:8px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:9px;padding:8px;font:12px ui-monospace,monospace">${escH(m.code)}</textarea></div>`).join("") || '<p class="muted">No mods yet.</p>'}
      <div class="row" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        <input type="text" id="modname" placeholder="Mod name" style="flex:1;min-width:140px"><select id="modtype"><option value="css">CSS</option><option value="js">JavaScript</option></select><button class="primary" id="modadd">Add mod</button></div>
      <h3 style="margin:16px 0 6px">Starter mods</h3><div class="presets">${STARTER_MODS.map((m, i) => `<button data-starter="${i}">${escH(m.name)}</button>`).join("")}</div>`;
  }
  const STARTER_MODS = [
    { name: "Rainbow titles", type: "css", code: ".card h3{background:linear-gradient(90deg,#ff5f6d,#ffc371,#47e891,#5ac8fa,#a66cff);-webkit-background-clip:text;color:transparent}" },
    { name: "Wide reading column", type: "css", code: ".dwrap{max-width:1200px}" },
    { name: "Hide 'Send to tool' button", type: "css", code: ".menuwrap{display:none}" },
    { name: "Auto-refresh feed every 2 minutes", type: "js", code: "setInterval(() => { if (document.visibilityState === 'visible' && typeof feed !== 'undefined' && feed.loaded && feed.target !== 'bookmarks') loadFeed(feed.target); }, 120000);" },
    { name: "Title-case all titles", type: "js", code: "Studio.on('feed', () => document.querySelectorAll('.card h3').forEach(h => h.textContent = h.textContent.replace(/\\b\\w/g, c => c.toUpperCase())));" },
    { name: "Log every opened post", type: "js", code: "Studio.on('post', p => console.log('Opened', p.id, p.title));" },
  ];
  function openSettings(cat) {
    if (cat) setCat = cat;
    let m = $("#setmodal");
    if (!m) {
      m = document.createElement("div"); m.className = "modalbg"; m.id = "setmodal";
      m.innerHTML = `<div class="modal" role="dialog" aria-label="Settings"><div class="sethead"><b style="font-size:17px">Settings</b>
        <input type="text" id="setq" placeholder="Search ${O.length} settings…"><button class="ghost" id="setclose" aria-label="Close">✕</button></div>
        <div class="setbody"><nav class="setnav" id="setnav"></nav><div class="setlist" id="setlist"></div></div></div>`;
      document.body.appendChild(m);
      m.addEventListener("click", e => { if (e.target === m) closeSettings(); });
      $("#setclose").onclick = closeSettings;
      $("#setq").oninput = drawSettings;
      wireSettings();
    }
    m.hidden = false; drawSettings();
  }
  function closeSettings() { const m = $("#setmodal"); if (m) m.hidden = true; }
  function drawSettings() {
    const q = ($("#setq").value || "").trim().toLowerCase();
    $("#setnav").innerHTML = CATS.map(c => `<button class="${c === setCat && !q ? "on" : ""}" data-cat="${escH(c)}">${escH(c)}</button>`).join("");
    const list = $("#setlist");
    if (q) { list.innerHTML = O.filter(o => (o.label + " " + o.cat).toLowerCase().includes(q)).map(rowHTML).join("") || '<p class="muted">No settings match.</p>'; return; }
    if (setCat === "Setup") list.innerHTML = setupHTML();
    else if (setCat === "Network") drawNetwork(list);
    else if (setCat === "Storage") drawStorage(list);
    else if (setCat === "Mods") list.innerHTML = modsHTML();
    else list.innerHTML = O.filter(o => o.cat === setCat).map(rowHTML).join("");
  }
  function wireSettings() {
    const list = $("#setlist");
    $("#setnav").onclick = e => { const b = e.target.closest("[data-cat]"); if (b) { setCat = b.dataset.cat; $("#setq").value = ""; drawSettings(); } };
    list.addEventListener("change", e => {
      const t = e.target, id = t.dataset.o;
      if (id) {
        const o = OPT[id];
        let v = o.type === "toggle" ? t.checked : o.type === "range" ? Number(t.value) : t.value;
        if (o.type === "toggle" && v && o.confirm && !confirm(o.confirm)) { t.checked = false; return; }
        if (id === "pin" && v && !/^\d{4,8}$/.test(v)) { say("PIN must be 4–8 digits"); t.value = opt("pin"); return; }
        setOpt(id, v);
        if (o.type === "range") t.closest(".setrow").querySelector("small").textContent = v + (o.unit ? " " + o.unit : "");
      }
      if (t.dataset.modon != null) { const m = mods(); m[+t.dataset.modon].on = t.checked; saveMods(m); if (t.checked && m[+t.dataset.modon].type === "js") say("JavaScript mods run the next time the app opens"); }
      if (t.dataset.modcode != null) { const m = mods(); m[+t.dataset.modcode].code = t.value; saveMods(m); }
    });
    list.addEventListener("input", e => {
      const t = e.target;
      if (t.type === "range" && t.dataset.o) { const o = OPT[t.dataset.o]; setOpt(o.id, Number(t.value)); t.closest(".setrow").querySelector("small").textContent = t.value + (o.unit ? " " + o.unit : ""); }
      if (t.tagName === "TEXTAREA" && t.dataset.o === "customCSS") { V.customCSS = t.value; LS.set("rs_opts", V); applyAll(); }
    });
    list.addEventListener("click", e => {
      const b = e.target.closest("button,[data-theme-pick]"); if (!b) return;
      if (b.dataset.b) OPT[b.dataset.b].run();
      if (b.dataset.themePick && window.setTheme) { setTheme(b.dataset.themePick); themeBefore = null; drawSettings(); }
      if (b.dataset.preset) { Object.entries(PRESETS[b.dataset.preset]).forEach(([k, v]) => (V[k] = v)); LS.set("rs_opts", V); applyAll(); rerender(); say(b.dataset.preset + " preset applied"); }
      if (b.hasAttribute("data-wizard")) { closeSettings(); wizard(); }
      if (b.hasAttribute("data-helper")) { closeSettings(); $("#helpbtn") && $("#helpbtn").click(); }
      if (b.hasAttribute("data-dir")) { closeSettings(); $("#dirbtn") && $("#dirbtn").click(); }
      if (b.dataset.moddel != null) { const m = mods(); if (confirm(`Delete mod "${m[+b.dataset.moddel].name}"?`)) { m.splice(+b.dataset.moddel, 1); saveMods(m); drawSettings(); } }
      if (b.id === "modadd") { const name = $("#modname").value.trim() || "My mod"; const m = mods(); m.push({ name, type: $("#modtype").value, code: "", on: true }); saveMods(m); drawSettings(); }
      if (b.dataset.starter != null) { const s = STARTER_MODS[+b.dataset.starter], m = mods(); m.push({ ...s, on: true }); saveMods(m); drawSettings(); if (s.type === "js") runOne(s); say(`Added "${s.name}"`); }
    });
  }
  function runOne(m) { try { new Function("Studio", m.code)(window.Studio); } catch (e) { say(`Mod failed: ${e.message}`); } }
  /* ---------------- Network (proxy) ---------------- */
  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "X-Reddit-Studio": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); if (!j.ok) throw new Error(j.error || "Something went wrong"); return j.result;
  };
  async function drawNetwork(list) {
    list.innerHTML = '<p class="muted">Loading…</p>';
    let n; try { n = await api("/api/network"); } catch (e) { list.innerHTML = `<p class="error">${escH(e.message)}</p>`; return; }
    const lt = n.last_test;
    list.innerHTML = `<p class="muted" style="font-size:13px">Send Reddit Studio's internet traffic (Reddit, RedGIFs, the archive and updates) through a proxy. Your own Mac's traffic isn't affected.
        If you use a VPN app (for example Proton VPN), you don't need this: the VPN already covers the whole Mac.</p>
      <label class="setrow"><span class="lbl">Use a proxy<small>${n.active ? "On: " + escH(n.url) : "Off: connecting directly"}</small></span><input type="checkbox" class="sw" id="net-on" ${n.on ? "checked" : ""}></label>
      <div class="setrow"><span class="lbl">Proxy address<small>http://host:port or socks5://host:port (user:password@ allowed)</small></span><input type="text" id="net-url" value="${escH(n.url)}" placeholder="socks5://127.0.0.1:9050" spellcheck="false"></div>
      <div class="presets">${n.presets.map(p => `<button data-netpreset="${escH(p.url)}" title="${escH(p.label)}">${escH(p.label.split(" (")[0])}: ${escH(p.url)}</button>`).join("")}</div>
      <div class="presets"><button class="primary" id="net-save">Save</button><button id="net-test">Test connection</button><button id="net-direct">Test without proxy</button></div>
      <div id="net-out" class="${lt ? (lt.ok ? "" : "error") : "muted"}" style="font-size:13px">${lt ? escH(`${lt.message} (${lt.via}, ${lt.ms} ms)`) : "Not tested yet."}</div>
      ${n.socks_ready ? "" : '<p class="muted" style="font-size:12px">SOCKS support installs with this update; HTTP proxies work right away.</p>'}
      <h3 style="margin:16px 0 6px">Free, open-source option: Tor</h3>
      <p class="muted" style="font-size:13px">Tor is free and open source. Easiest: open <b>Tor Browser</b> and pick the "Tor Browser" preset (port 9150) while it's running. Reddit sometimes blocks Tor exit addresses; the test tells you.</p>`;
    const out = (m, ok) => { const o = $("#net-out"); o.className = ok ? "" : "error"; o.style.fontSize = "13px"; o.textContent = m; };
    list.querySelectorAll("[data-netpreset]").forEach(b => b.onclick = () => { $("#net-url").value = b.dataset.netpreset; });
    $("#net-save").onclick = async () => {
      try { await api("/api/network", { on: $("#net-on").checked, url: $("#net-url").value }); say("Network settings saved"); drawNetwork(list); }
      catch (e) { out(e.message, false); }
    };
    $("#net-on").onchange = () => $("#net-save").click();
    $("#net-test").onclick = async () => {
      out("Testing…", true);
      try { const r = await api("/api/network/test", { url: $("#net-url").value || null }); out(`${r.message} (${r.via}, ${r.ms} ms)`, r.ok); }
      catch (e) { out(e.message, false); }
    };
    $("#net-direct").onclick = async () => {
      out("Testing…", true);
      try { const r = await api("/api/network/test", {}); out(`${r.message} (${r.via}, ${r.ms} ms)`, r.ok); } catch (e) { out(e.message, false); }
    };
  }

  /* ---------------- Storage (Downloads tidy) ---------------- */
  async function drawStorage(list) {
    list.innerHTML = '<p class="muted">Loading…</p>';
    let h; try { h = await api("/api/helper"); } catch (e) { list.innerHTML = `<p class="error">${escH(e.message)}</p>`; return; }
    if (h.local === false) { list.innerHTML = '<p class="muted">Storage settings are only available on the computer.</p>'; return; }
    const t = h.tidy || {};
    list.innerHTML = `<p class="muted" style="font-size:13px">Reddit Studio keeps its own files (update files, installers, snapshots, settings exports, your source folder) in <b>${escH(t.root || "~/Reddit Studio Files")}</b> instead of Downloads, and prunes old copies. Nothing else in Downloads is ever touched.</p>
      <label class="setrow"><span class="lbl">Tidy Downloads automatically<small>After every update, after publishing, and once a day</small></span><input type="checkbox" class="sw" id="tidy-auto" ${t.auto ? "checked" : ""}></label>
      <div class="setrow"><span class="lbl">In Downloads right now<small>${t.clutter && t.clutter.length ? t.clutter.map(c => escH(c.name)).join(", ") : "Nothing to tidy"}</small></span><button id="tidy-now">Tidy now</button></div>
      <div class="setrow"><span class="lbl">Last tidy<small>${t.last ? `moved ${t.last.moved}, freed ${escH(t.last.freed)}` : "Not yet"}</small></span><button id="tidy-open">Open folder</button></div>`;
    $("#tidy-auto").onchange = async e => { try { await api("/api/helper/tidy_auto", { on: e.target.checked }); say(e.target.checked ? "Auto-tidy on" : "Auto-tidy off"); } catch (err) { say(err.message); } };
    $("#tidy-now").onclick = () => { closeSettings(); window.helperRun && helperRun("tidy"); };
    $("#tidy-open").onclick = () => { window.helperRun && helperRun("open_files"); };
  }

  function scriptConsole() {
    closeSettings();
    const m = document.createElement("div"); m.className = "modalbg"; m.style.zIndex = 125;
    m.innerHTML = `<div class="modal wide"><div style="display:flex;align-items:center;gap:8px"><b style="flex:1;font-size:17px">Script console</b><button class="ghost" data-x>✕</button></div>
      <p class="muted" style="font-size:12.5px">Runs JavaScript in the app. Handy values: <code>feed.posts</code>, <code>Studio</code>, <code>RSViews</code>, <code>getJSON(url)</code>. The last expression's value is shown. Use <code>await</code> freely.</p>
      <textarea id="sc-code" spellcheck="false" style="width:100%;min-height:150px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:9px;padding:8px;font:12px ui-monospace,Menlo,monospace">${escH(LS.get("rs_console", "feed.posts.filter(p => p.score > 1000).map(p => p.title)"))}</textarea>
      <div style="display:flex;gap:6px;margin:8px 0"><button class="primary" id="sc-run">Run (Cmd+Enter)</button><button id="sc-save">Save as JS mod</button></div>
      <pre class="out" id="sc-out" style="max-height:40vh">Output appears here.</pre></div>`;
    document.body.appendChild(m);
    const code = m.querySelector("#sc-code"), out = m.querySelector("#sc-out");
    const run = async () => {
      LS.set("rs_console", code.value);
      try {
        const src = code.value.trim(), lines = src.split("\n"), last = lines.pop();
        const body = lines.join("\n") + "\nreturn (" + last.replace(/;\s*$/, "") + ");";
        let v; try { v = await (new Function("return (async () => {" + body + "})()"))(); } catch (e) { if (e instanceof SyntaxError) v = await (new Function("return (async () => {" + src + "})()"))(); else throw e; }
        out.textContent = typeof v === "string" ? v : JSON.stringify(v, null, 2) ?? String(v);
      } catch (e) { out.textContent = "Error: " + e.message; }
    };
    m.querySelector("#sc-run").onclick = run;
    code.onkeydown = e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run(); };
    m.querySelector("#sc-save").onclick = () => { const name = prompt("Name this mod:", "My script"); if (!name) return; const ms = mods(); ms.push({ name, type: "js", code: code.value, on: true }); saveMods(ms); say("Saved as a mod"); };
    m.onclick = e => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); };
  }

  function exportSettings() {
    const data = { app: "Reddit Studio", exported: new Date().toISOString(), opts: V, mods: mods(), favs: LS.get("rs_favs", []), theme: LS.get("rs_theme"), accent: LS.get("rs_accent"), bookmarks: bookmarks() };
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = "reddit-studio-settings.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function importSettings() {
    const i = document.createElement("input"); i.type = "file"; i.accept = "application/json,.json";
    i.onchange = async () => {
      try {
        const d = JSON.parse(await i.files[0].text());
        if (d.opts) LS.set("rs_opts", d.opts); if (d.mods) LS.set("rs_mods", d.mods); if (d.favs) LS.set("rs_favs", d.favs);
        if (d.theme) LS.set("rs_theme", d.theme); if (d.accent !== undefined) LS.set("rs_accent", d.accent); if (d.bookmarks) LS.set("rs_bm", d.bookmarks);
        location.reload();
      } catch (e) { say("That file isn't a Reddit Studio settings export"); }
    };
    i.click();
  }

  /* ---------------- right-click menu on posts ---------------- */
  function ctxMenu(x, y, p) {
    closeCtx();
    const m = document.createElement("div"); m.id = "ctx";
    const items = [
      ["open", "Open"], ["reddit", "Open on Reddit"], ["copy", "Copy link"], p.media && p.media.link && !/reddit\.com/.test(p.domain) ? ["copymedia", "Copy media link"] : null, null,
      ["bm", isBookmarked(p.id) ? "Remove bookmark" : "Bookmark"], ["read", readSet.has(p.id) ? "Mark as unread" : "Mark as read"], ["hide", "Hide this post"], null,
      ["fav", "Favorite r/" + p.subreddit], ["mutesub", "Mute r/" + p.subreddit], ["muteuser", "Mute u/" + p.author], null,
      ["coll", "Add to collection…"], ["tag", "Tag u/" + p.author + "…"], ["download", "Download media"], ["feedadd", "Add r/" + p.subreddit + " to a custom feed…"], null,
      ["subtools", "Analyze r/" + p.subreddit + " in Tools"], ["usertools", "Look up u/" + p.author], ["json", "View JSON"],
    ];
    m.innerHTML = items.map(it => it ? `<button data-a="${it[0]}">${escH(it[1])}</button>` : "<hr>").join("");
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 8) + "px"; m.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
    m.onclick = e => { const b = e.target.closest("[data-a]"); if (!b) return; closeCtx(); doAction(b.dataset.a, p); };
  }
  function closeCtx() { const m = $("#ctx"); if (m) m.remove(); }
  function appendList(id, val) { const l = listOf(opt(id)); if (!l.includes(val.toLowerCase())) { l.push(val); setOpt(id, l.join(", ")); } }
  function doAction(a, p) {
    if (a === "open") location.hash = "#/comments/" + p.id;
    if (a === "reddit") openExternal(p.url);
    if (a === "copy") copyText(p.url);
    if (a === "copymedia") copyText(p.media.link);
    if (a === "bm") toggleBookmark(p);
    if (a === "read") { readSet.has(p.id) ? readSet.delete(p.id) : readSet.add(p.id); saveRead(); rerender(); }
    if (a === "hide") { const feed = G.feed(); readSet.add(p.id); saveRead(); feed.posts = feed.posts.filter(x => x.id !== p.id); rerender(); say("Hidden"); }
    if (a === "fav" && window.toggleFav) { if (!favs().some(x => x.toLowerCase() === p.subreddit.toLowerCase())) toggleFav(p.subreddit); say("Added to favorites"); }
    if (a === "mutesub") { appendList("muteSubs", p.subreddit); say("Muted r/" + p.subreddit); }
    if (a === "muteuser") { appendList("muteUsers", p.author); say("Muted u/" + p.author); }
    if (a === "subtools" && window.sendToTool) sendToTool("sub_info", { sub: p.subreddit });
    if (a === "usertools" && window.sendToTool) sendToTool("user", { name: p.author });
    if (a === "json") showJSON(p);
    if (a === "coll") addToCollection(p);
    if (a === "tag" && window.RSViews) RSViews.tagUser(p.author);
    if (a === "download" && window.RSViews) RSViews.download(p.id);
    if (a === "feedadd" && window.RSViews) RSViews.addToFeed(p.subreddit);
  }
  function addToCollection(p) {
    const colls = LS.get("rs_coll", {}), names = Object.keys(colls);
    const name = (prompt("Add to which collection?" + (names.length ? "\nExisting: " + names.join(", ") : ""), names[0] || "Favorites") || "").trim();
    if (!name) return;
    const list = (colls[name] || []).filter(x => x.id !== p.id); list.unshift(p); colls[name] = list.slice(0, 1000);
    LS.set("rs_coll", colls); say(`Added to “${name}”`);
  }
  function saveRead() { LS.set("rs_read", [...readSet].slice(-5000)); }
  function openExternal(u) { if (opt("confirmExternal") && !confirm("Open this link?\n\n" + u)) return; window.open(u, "_blank", "noopener"); }
  function showJSON(p) {
    const m = document.createElement("div"); m.className = "modalbg"; m.style.zIndex = 125;
    m.innerHTML = `<div class="modal wide"><div style="display:flex;gap:8px;align-items:center"><b style="flex:1">Post data</b><button data-c>Copy</button><button class="ghost" data-x>✕</button></div><pre class="out" style="max-height:70vh">${escH(JSON.stringify(p, null, 2))}</pre></div>`;
    document.body.appendChild(m);
    m.onclick = e => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); if (e.target.closest("[data-c]")) copyText(JSON.stringify(p, null, 2)); };
  }

  /* ---------------- command palette ---------------- */
  function paletteItems() {
    const items = [];
    const go = (label, hash, hint) => items.push({ label, hint, run: () => (location.hash = hash) });
    go("Popular", "#/r/popular", "Go"); go("All", "#/r/all", "Go"); go("Bookmarks", "#/bookmarks", "Go"); go("History", "#/history", "Go");
    Object.keys(LS.get("rs_feeds", {})).forEach(n => go("📚 " + n, "#/f/" + n, "Custom feed"));
    Object.keys(LS.get("rs_coll", {})).forEach(n => go("🗂 " + n, "#/c/" + n, "Collection"));
    if (window.RSViews) RSViews.MODES.forEach(([id, label]) => items.push({ label: "View: " + label, hint: "View", run: () => RSViews.setView(id) }));
    items.push({ label: "Download media from this feed", hint: "Action", run: () => window.RSViews && RSViews.download() });
    items.push({ label: "Custom feeds…", hint: "Action", run: () => window.RSViews && RSViews.feedsManager() });
    if (opt("explicit")) go("Explicit feed", "#/explicit", "Go");
    if (G.account().available) { go("Home feed", "#/home", "Go"); go("Saved posts", "#/saved", "Go"); }
    LS.get("rs_favs", []).forEach(s => go("r/" + s, "#/r/" + s, "Favorite"));
    LS.get("rs_recent", []).forEach(t => go(t, "#/" + t, "Recent"));
    (G.tools() || []).forEach(t => items.push({ label: t.name, hint: "Tool", run: () => (location.hash = "#/tools/" + t.id) }));
    O.forEach(o => items.push({ label: o.label, hint: "Setting · " + o.cat, run: () => { openSettings(o.cat); setTimeout(() => { const el = $("#opt-" + o.id); el && el.scrollIntoView({ block: "center" }); el && el.focus(); }, 30); } }));
    Object.entries(THEMES).forEach(([id, t]) => items.push({ label: "Theme: " + t[0], hint: "Theme", run: () => setTheme(id) }));
    [["Open Helper", () => $("#helpbtn").click()], ["Reddit account", () => $("#acct").click()], ["Communities", () => $("#dirbtn").click()],
     ["Settings", () => openSettings()], ["Keyboard shortcuts", () => cheatSheet()], ["Lock now", () => lock()], ["Setup wizard", () => wizard()],
     ["Check for updates", () => $("#ver").click()], ["Toggle grid / list", () => setLayout($("#feed").classList.contains("grid") ? "list" : "grid")]]
      .forEach(([label, run]) => items.push({ label, hint: "Action", run }));
    return items;
  }
  function palette() {
    if ($("#palette")) return;
    const all = paletteItems();
    const w = document.createElement("div"); w.id = "palette";
    w.innerHTML = `<div class="pbox"><input placeholder="Type a community, tool, setting, theme or action… (r/name works too)"><div class="plist"></div></div>`;
    document.body.appendChild(w);
    const inp = w.querySelector("input"), list = w.querySelector(".plist");
    let sel = 0, shown = [];
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      shown = q ? all.filter(i => i.label.toLowerCase().includes(q) || i.hint.toLowerCase().includes(q)) : all.slice(0, 40);
      if (/^(r|u)\/[A-Za-z0-9_+\-]+$/i.test(inp.value.trim())) shown.unshift({ label: "Open " + inp.value.trim(), hint: "Go", run: () => (location.hash = "#/" + inp.value.trim()) });
      shown = shown.slice(0, 60); sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = shown.map((i, n) => `<div class="pi ${n === sel ? "on" : ""}" data-n="${n}">${escH(i.label)}<small>${escH(i.hint)}</small></div>`).join("") || '<div class="pi">Nothing matches</div>';
      const on = list.querySelector(".pi.on"); on && on.scrollIntoView({ block: "nearest" });
    };
    const close = () => w.remove();
    const run = n => { const i = shown[n]; close(); i && i.run(); };
    inp.oninput = () => { sel = 0; draw(); };
    inp.onkeydown = e => {
      if (e.key === "ArrowDown") { sel = Math.min(shown.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === "Enter") run(sel);
      else if (e.key === "Escape") close();
    };
    list.onclick = e => { const p = e.target.closest("[data-n]"); if (p) run(+p.dataset.n); };
    w.onclick = e => { if (e.target === w) close(); };
    draw(); inp.focus();
  }

  /* ---------------- lightbox ---------------- */
  function lightbox(srcs, idx, isVideo) {
    const w = document.createElement("div"); w.id = "lightbox";
    let i = idx;
    const draw = () => {
      w.innerHTML = `${isVideo ? `<video src="${escH(srcs[i])}" controls autoplay ${opt("startMuted") ? "muted" : ""} ${opt("loopVideos") ? "loop" : ""}></video>` : `<img src="${escH(srcs[i])}" alt="">`}
        <button class="lbx" data-x>✕</button>${srcs.length > 1 ? `<button class="lbn" data-p style="left:12px">‹</button><button class="lbn" data-n style="right:12px">›</button><div class="lbc">${i + 1} / ${srcs.length}</div>` : ""}`;
    };
    const close = () => { w.remove(); document.removeEventListener("keydown", key, true); };
    const key = e => {
      if (e.key === "Escape") { close(); e.stopPropagation(); }
      if (e.key === "ArrowRight" && srcs.length > 1) { i = (i + 1) % srcs.length; draw(); }
      if (e.key === "ArrowLeft" && srcs.length > 1) { i = (i - 1 + srcs.length) % srcs.length; draw(); }
    };
    w.onclick = e => {
      if (e.target.closest("[data-n]")) { i = (i + 1) % srcs.length; draw(); }
      else if (e.target.closest("[data-p]")) { i = (i - 1 + srcs.length) % srcs.length; draw(); }
      else if (e.target === w || e.target.closest("[data-x]")) close();
    };
    document.addEventListener("keydown", key, true);
    draw(); document.body.appendChild(w);
  }

  /* ---------------- PIN lock, panic, blur-on-leave ---------------- */
  function lock() {
    const pin = opt("pin"); if (!pin) { openSettings("Privacy"); say("Set a PIN first"); return; }
    if ($("#lockscreen")) return;
    $$("video").forEach(v => v.pause());
    const w = document.createElement("div"); w.id = "lockscreen";
    w.innerHTML = `<div class="lk"><b style="font-size:18px">Reddit Studio is locked</b><input type="password" inputmode="numeric" autocomplete="off" placeholder="PIN"><span class="muted" style="font-size:12px">This keeps casual eyes out; it isn't encryption.</span></div>`;
    document.body.appendChild(w);
    const inp = w.querySelector("input"); inp.focus();
    inp.oninput = () => { if (inp.value === pin) w.remove(); };
  }
  function panic() {
    $$("video").forEach(v => v.pause());
    $$(".modalbg").forEach(m => (m.hidden = true)); closeCtx(); $("#lightbox") && $("#lightbox").remove(); $("#palette") && $("#palette").remove();
    leaveExplicitLook();
    if (window.closeDetailOnMobile) closeDetailOnMobile();
    const d = $("#detail"); if (d) d.innerHTML = '<div class="dempty">Pick a post to read it here.</div>';
    location.hash = "#/" + (opt("panicPage") || "r/technology").replace(/^#?\/?/, "");
  }

  /* ---------------- keyboard ---------------- */
  let gPending = 0;
  function playerKeys() {
    const rows = [["Space / k", "Play or pause"], ["← / →", "Skip back / forward"], ["↑ / ↓", "Volume"], ["m", "Mute"], ["f", "Full screen"],
      [", / .", "Step one frame back / forward"], ["l", "Loop on or off"], ["0–9", "Jump to 0%–90%"], ["Scroll / pinch", "Zoom images"], ["r", "Rotate image in the zoom viewer"]];
    const m = document.createElement("div"); m.className = "modalbg"; m.style.zIndex = 125;
    m.innerHTML = `<div class="modal"><div style="display:flex;align-items:center"><b style="flex:1;font-size:17px">Player shortcuts</b><button class="ghost" data-x>✕</button></div>
      <p class="muted" style="font-size:12.5px">Click a video first so it has focus.</p>
      <table style="width:100%;font-size:13px">${rows.map(([k, d]) => `<tr><td style="padding:4px 10px 4px 0"><span class="kbd">${escH(k)}</span></td><td>${escH(d)}</td></tr>`).join("")}</table></div>`;
    document.body.appendChild(m);
    m.onclick = e => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); };
  }
  function cheatSheet() {
    const rows = [["/", "Search / address bar"], ["j / k", "Move through posts"], ["Enter", "Open selected post"], ["n / p", "Next / previous post"],
      ["o", "Open the post's link"], ["b", "Bookmark the open post"], ["m", "Mute the open post's community"], ["g p", "Popular"], ["g h", "Home feed"],
      ["g s", "Saved posts"], ["g e", "Explicit feed"], ["g b", "Bookmarks"], ["g t", "Tools"], ["Cmd/Ctrl+K", "Command palette"], ["Cmd/Ctrl+,", "Settings"],
      ["`", "Panic: hide everything"], ["← / →", "Previous / next image in the viewer"], ["Esc", "Close windows"], ["?", "This list"]];
    const m = document.createElement("div"); m.className = "modalbg"; m.style.zIndex = 125;
    m.innerHTML = `<div class="modal"><div style="display:flex;align-items:center"><b style="flex:1;font-size:17px">Keyboard shortcuts</b><button class="ghost" data-x>✕</button></div>
      <table style="width:100%;margin-top:10px;font-size:13px">${rows.map(([k, d]) => `<tr><td style="padding:4px 10px 4px 0"><span class="kbd">${escH(k)}</span></td><td>${escH(d)}</td></tr>`).join("")}</table></div>`;
    document.body.appendChild(m);
    m.onclick = e => { if (e.target === m || e.target.closest("[data-x]")) m.remove(); };
  }
  function onKey(e) {
    if (e.target.closest && e.target.closest(".plyr, .pswp")) return;     // the player handles its own keys
    const typing = e.target.closest && e.target.closest("input,textarea,select,[contenteditable]");
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && opt("paletteKey")) { e.preventDefault(); palette(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === ",") { e.preventDefault(); openSettings(); return; }
    if (e.key === "Escape") { closeCtx(); if ($("#setmodal") && !$("#setmodal").hidden) closeSettings(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "`" && opt("panicKey")) { e.preventDefault(); panic(); return; }
    if (e.key === "?") { cheatSheet(); return; }
    if (opt("gotoKeys")) {
      if (e.key === "g") { gPending = Date.now(); return; }
      if (Date.now() - gPending < 1200) {
        gPending = 0;
        const map = { p: "#/r/popular", h: "#/home", s: "#/saved", e: "#/explicit", b: "#/bookmarks", t: "#/tools" };
        if (map[e.key]) { location.hash = map[e.key]; return; }
      }
    }
    if (!G.feed()) return;
    if (opt("npKeys") && (e.key === "n" || e.key === "p")) {
      const cards = $$("#feed .card"); if (!cards.length) return;
      let i = cards.findIndex(c => c.dataset.id === G.openId());
      i = e.key === "n" ? Math.min(cards.length - 1, i + 1) : Math.max(0, i - 1);
      cards[i].scrollIntoView({ block: "nearest" }); location.hash = "#/comments/" + cards[i].dataset.id; return;
    }
    if (opt("actionKeys") && current) {
      if (e.key === "o") openExternal(current.media && current.media.link && current.media.type !== "text" ? current.media.link : current.url);
      if (e.key === "b") toggleBookmark(current);
      if (e.key === "m") { appendList("muteSubs", current.subreddit); say("Muted r/" + current.subreddit); }
    }
  }

  /* ---------------- setup wizard ---------------- */
  function wizard() {
    const m = document.createElement("div"); m.className = "modalbg"; m.style.zIndex = 126;
    const steps = [
      () => `<h2 style="margin:0 0 6px">Welcome to Reddit Studio</h2><p class="muted">A quick setup: pick a look, a start page and what you want to see. You can change everything later in Settings (the sliders button, or Cmd+,).</p>`,
      () => `<h3>Pick a theme</h3><div class="themegrid">${["midnight", "daylight", "oled", "dracula", "nord", "gruvbox", "ocean", "rose", "paper", "synth"].map(id => `<div class="themecard ${document.documentElement.dataset.theme === id ? "on" : ""}" data-theme-pick="${id}">${escH((THEMES[id] || [id[0].toUpperCase() + id.slice(1)])[0])}</div>`).join("")}</div>`,
      () => `<h3>Start page</h3><p class="muted">What opens when you launch the app.</p><input type="text" id="wz-start" value="${escH(opt("startPage"))}" style="width:100%">
        <label class="setrow"><span class="lbl">Start in grid view</span><input type="checkbox" class="sw" id="wz-grid" ${opt("defaultGrid") ? "checked" : ""}></label>`,
      () => `<h3>Explicit content</h3><p class="muted">Off by default. Turn it on only if you're 18 or older. Explicit posts stay blurred until clicked, and the \` key hides everything instantly.</p>
        <label class="setrow"><span class="lbl">Explicit mode</span><input type="checkbox" class="sw" id="wz-explicit" ${opt("explicit") ? "checked" : ""}></label>`,
      () => `<h3>Get full data</h3><p class="muted">Reddit blocks a lot of apps now. The most reliable fix is the Chrome extension, which reads through your normal Chrome. The Helper sets it up.</p><button class="primary" data-helper>Open Helper</button>`,
    ];
    let i = 0;
    const draw = () => {
      m.innerHTML = `<div class="modal" style="width:min(520px,100%)">${steps[i]()}<div style="display:flex;gap:8px;margin-top:16px">
        <span class="muted" style="flex:1;font-size:12px">Step ${i + 1} of ${steps.length}</span><button class="ghost" data-skip>Skip</button>${i ? '<button data-back>Back</button>' : ""}
        <button class="primary" data-next>${i === steps.length - 1 ? "Done" : "Next"}</button></div></div>`;
    };
    m.onclick = e => {
      const t = e.target.closest("[data-theme-pick],[data-next],[data-back],[data-helper],[data-skip]"); if (!t) return;
      if (t.hasAttribute("data-skip")) return finish();
      if (t.dataset.themePick) { setTheme(t.dataset.themePick); draw(); return; }
      if (t.hasAttribute("data-helper")) { finish(); $("#helpbtn").click(); return; }
      if (t.hasAttribute("data-back")) { i--; draw(); return; }
      if ($("#wz-start")) { setOpt("startPage", $("#wz-start").value.trim() || "r/popular"); setOpt("defaultGrid", $("#wz-grid").checked); }
      if ($("#wz-explicit")) {
        const want = $("#wz-explicit").checked;
        if (want && !opt("explicit") && !confirm("Turn on explicit 18+ mode? Only continue if you are 18 or older.")) $("#wz-explicit").checked = false;
        else setOpt("explicit", want);
      }
      if (i === steps.length - 1) return finish();
      i++; draw();
    };
    const finish = () => { LS.set("rs_wizard_done", true); m.remove(); };
    draw(); document.body.appendChild(m);
  }

  /* ---------------- after a feed renders / a post opens ---------------- */
  const hooks = { feed: [], post: [] };
  let tFeed = 0;
  document.addEventListener("rs:feed", () => {
    const feed = G.feed(); if (!feed) return;
    if (opt("perfHud")) hud(`feed: ${feed.posts.length} posts, ${$$("#feed .card").length} shown, ${(performance.now() - tFeed).toFixed(0)} ms`);
    const multi = "r/" + explicitSubs().join("+");
    if (inExplicit()) {
      $("#feedtitle").textContent = "🔥 Explicit" + (feed.target.toLowerCase() === multi ? "" : " · " + feed.target);
      if (feed.target.toLowerCase() === multi) {
        $("#addr").value = "explicit";
        const r = LS.get("rs_recent", []), clean = r.filter(t => !String(t).includes("+") || String(t).toLowerCase() !== multi);
        if (clean.length !== r.length) { LS.set("rs_recent", clean); window.renderChips && renderChips(); }
      }
    }
    if (customFeed && feed.target.toLowerCase() === customFeed.target) {
      $("#feedtitle").textContent = "📚 " + customFeed.name; $("#addr").value = "f/" + customFeed.name;
      const r = LS.get("rs_recent", []), clean = r.filter(t => String(t).toLowerCase() !== customFeed.target);
      if (clean.length !== r.length) { LS.set("rs_recent", clean); window.renderChips && renderChips(); }
    }
    if (feed.target && feed.target !== "bookmarks") LS.set("rs_last", feed.target.toLowerCase() === multi ? "explicit" : feed.target);
    badge();
    hooks.feed.forEach(f => { try { f(); } catch (e) { console.warn(e); } });
  });
  document.addEventListener("rs:post", e => {
    const { p, el } = e.detail; current = p;
    const hist = LS.get("rs_hist", []).filter(x => x.id !== p.id); hist.unshift(p); LS.set("rs_hist", hist.slice(0, 300));
    if (opt("markRead") && !readSet.has(p.id)) { readSet.add(p.id); saveRead(); const c = document.querySelector(`.card[data-id="${CSS.escape(p.id)}"]`); c && c.classList.add("read"); }
    const v = el.querySelector(".media video");
    if (v) {
      if (/\/api\/redgifs\//.test(v.dataset.mp4 || "") && opt("redgifsQuality") === "sd") v.src = v.dataset.mp4 + "?q=sd";
      v.muted = !!opt("startMuted") || (adult(p) && opt("explicitAutoplay"));
      v.loop = !!opt("loopVideos") || v.loop;
      v.playbackRate = Number(opt("speed")) || 1;
      v.addEventListener("loadedmetadata", () => (v.playbackRate = Number(opt("speed")) || 1), { once: true });
      const blurred = v.classList.contains("blurred");
      if (!blurred && (opt("autoplay") || (adult(p) && opt("explicitAutoplay")))) v.play().catch(() => {});
      if (opt("pipButton") && document.pictureInPictureEnabled && !opt("studioPlayer")) {
        const b = document.createElement("button"); b.className = "pipbtn"; b.title = "Picture in picture"; b.textContent = "⧉";
        b.onclick = ev => { ev.stopPropagation(); v.requestPictureInPicture().catch(() => {}); };
        v.parentElement.appendChild(b);
      }
    }
    if (opt("lightbox")) {
      const imgs = [...el.querySelectorAll(".media img")];
      imgs.forEach((img, n) => img.addEventListener("click", () => { if (!img.classList.contains("blurred") && !img.closest(".media").querySelector(".reveal")) lightbox(imgs.map(x => x.src), n, false); }));
      if (v && !opt("studioPlayer")) v.addEventListener("dblclick", () => lightbox([v.currentSrc || v.src], 0, true));
    }
    const depth = opt("collapseDepth");
    if (depth !== "off") el.querySelectorAll(`.cmt.d${depth}`).forEach(c => { c.classList.add("collapsed"); const t = c.querySelector(".tog"); if (t) t.textContent = "[+]"; });
    const actions = el.querySelector(".actions");
    if (actions) {
      const extra = [`<button data-sx="bm">${isBookmarked(p.id) ? "🔖 Bookmarked" : "🔖 Bookmark"}</button>`];
      if (opt("jsonButton")) extra.push(`<button data-sx="json">{ } View JSON</button>`);
      if (opt("copyIdButton")) extra.push(`<button data-sx="id">Copy ID</button><button data-sx="api">Copy API path</button>`);
      actions.insertAdjacentHTML("beforeend", extra.join(""));
      actions.addEventListener("click", ev => {
        const b = ev.target.closest("[data-sx]"); if (!b) return;
        if (b.dataset.sx === "bm") { toggleBookmark(p); b.textContent = isBookmarked(p.id) ? "🔖 Bookmarked" : "🔖 Bookmark"; }
        if (b.dataset.sx === "json") showJSON(p);
        if (b.dataset.sx === "id") copyText("t3_" + p.id);
        if (b.dataset.sx === "api") copyText(`https://www.reddit.com/comments/${p.id}.json?raw_json=1`);
      });
    }
    if (opt("confirmExternal")) el.querySelectorAll('a[target=_blank]').forEach(a => a.addEventListener("click", ev => { if (!confirm("Open this link?\n\n" + a.href)) ev.preventDefault(); }));
    hooks.post.forEach(f => { try { f(p, el); } catch (err) { console.warn(err); } });
  });
  function hud(t) { let h = $("#perfhud"); if (!h) { h = document.createElement("div"); h.id = "perfhud"; document.body.appendChild(h); } h.textContent = t; }
  function badge() {
    const head = $(".feedhead"); if (!head) return;
    let b = $("#srcbadge");
    if (!opt("sourceBadge")) { b && b.remove(); return; }
    if (!b) { b = document.createElement("span"); b.id = "srcbadge"; head.appendChild(b); }
    const a = G.account() || {};
    b.textContent = "source: " + (a.api && a.api.active ? "API key" : a.bridge && a.bridge.connected ? "Chrome" : a.available ? "sign-in" : a.archive && a.rss ? "archive" : a.rss ? "RSS" : "public");
  }

  /* ---------------- wire up once the page is ready ---------------- */
  function start() {
    $("#setbtn") && ($("#setbtn").onclick = () => openSettings());
    // more themes in the top-bar menu
    const sel = $("#theme");
    if (sel && !sel.querySelector('option[value="dracula"]')) {
      const g = document.createElement("optgroup"); g.label = "More themes";
      Object.entries(THEMES).forEach(([id, t]) => { const o = document.createElement("option"); o.value = id; o.textContent = t[0]; g.appendChild(o); });
      sel.appendChild(g);
      const saved = LS.get("rs_theme"); if (saved && THEMES[saved] && window.setTheme) setTheme(saved, true);
    }
    // explicit-mode toggle in Communities stays in sync
    const ad = $("#adult"); if (ad) ad.addEventListener("change", () => { V.explicit = ad.checked; LS.set("rs_opts", V); applyAll(); });
    const bl = $("#blur"); if (bl) bl.addEventListener("change", () => { V.blur = bl.checked; LS.set("rs_opts", V); });
    if (G.settings()) { G.settings().adult = !!opt("explicit"); G.settings().blur = !!opt("blur"); }
    // right-click menu on cards
    const fd = $("#feed");
    fd && fd.addEventListener("contextmenu", e => { const c = e.target.closest(".card"); if (!c) return; const p = postById(c.dataset.id); if (!p) return; e.preventDefault(); ctxMenu(e.clientX, e.clientY, p); });
    document.addEventListener("click", e => { if (!e.target.closest("#ctx")) closeCtx(); });
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", () => { if (opt("blurOnLeave")) document.documentElement.classList.add("blurall"); });
    window.addEventListener("focus", () => document.documentElement.classList.remove("blurall"));
    // follow macOS light/dark
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => { if (opt("autoTheme") === "on" && window.setTheme) setTheme(mq.matches ? "midnight" : "daylight", true); };
    mq.addEventListener && mq.addEventListener("change", follow); follow();
    // dev: log app requests
    const realFetch = window.fetch.bind(window);
    window.fetch = (...a) => { if (opt("logApi")) console.log("[Reddit Studio]", a[0]); tFeed = performance.now(); return realFetch(...a); };
    // add a Bookmarks / Explicit chip
    const chips = $("#chips");
    if (chips) new MutationObserver(() => {
      if (chips.querySelector("[data-studio]")) return;
      const extra = `<button class="chip" data-studio data-t="bookmarks">🔖 Bookmarks</button>` + (opt("explicit") ? `<button class="chip" data-studio data-t="explicit">🔥 Explicit</button>` : "")
        + Object.keys(LS.get("rs_feeds", {})).map(n => `<button class="chip" data-studio data-t="f/${escH(n)}">📚 ${escH(n)}</button>`).join("")
        + Object.keys(LS.get("rs_coll", {})).map(n => `<button class="chip" data-studio data-t="c/${escH(n)}">🗂 ${escH(n)}</button>`).join("")
        + `<button class="chip" data-studio data-t="history">🕘 History</button>`;
      chips.insertAdjacentHTML("afterbegin", extra);
    }).observe(chips, { childList: true });
    // if the app was updated while this window stayed open, offer a reload so the page matches
    let pageVer = null;
    const checkVer = async () => {
      try {
        const r = await (await fetch("/api/version", { cache: "no-store" })).json(); const v = r.result && r.result.version; if (!v) return;
        if (pageVer == null) pageVer = v;
        else if (v !== pageVer && !$("#verbanner")) {
          const b = document.createElement("div"); b.id = "verbanner";
          b.style.cssText = "position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:150;background:var(--accent);color:var(--bg);padding:8px 10px 8px 14px;border-radius:12px;display:flex;gap:10px;align-items:center;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.4)";
          b.innerHTML = `Reddit Studio was updated to ${escH(v)}. <button style="background:var(--bg);color:var(--text)">Reload</button>`;
          b.querySelector("button").onclick = () => location.reload();
          document.body.appendChild(b);
        }
      } catch {}
    };
    checkVer(); setInterval(checkVer, 30000);
    if (opt("pin")) lock();
    runJsMods();
    if (!LS.get("rs_wizard_done")) setTimeout(wizard, 600);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();

  /* ---------------- public API (for mods) ---------------- */
  window.Studio = {
    opt, set: setOpt, options: O, filterPost, cardClass, route, inExplicit, bookmarks, toggleBookmark,
    openSettings, palette, lock, panic, refreshChips: () => { const c = $("#chips"); c && c.querySelectorAll("[data-studio]").forEach(x => x.remove()); window.renderChips && renderChips(); }, lightbox, cheatSheet, wizard, themes: THEMES,
    on(ev, f) { (hooks[ev] || (hooks[ev] = [])).push(f); },
    count: () => ({ settings: O.length, themes: Object.keys(THEMES).length + 8, presets: Object.keys(PRESETS).length, starterMods: STARTER_MODS.length }),
  };
})();
