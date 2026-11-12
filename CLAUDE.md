# Reddit Studio — working notes

Mac app for reading and analyzing Reddit: Flask server + single-page UI, macOS menu bar app (rumps),
self-updater from GitHub tags, Control Center (`rsctl`), double-click installer. Read-only toward Reddit.

## Layout
- `app/` is what gets installed to `~/reddit-studio` (the running copy). Edit here, never in `~/reddit-studio`.
  - `app.py` Flask routes; phone access (LAN listener + QR token gate); update/sign-in/restart endpoints.
    State-changing endpoints require header `X-Reddit-Studio: 1` (blocks cross-site requests) and are refused from phones.
  - `reddit_tools.py` data layer + 37 tools. Fetch order: rdt-cli sign-in (`~/.config/rdt-cli/credential.json`)
    → anonymous `.json` → RSS → Arctic Shift archive (`_fetch_archive`, subreddit/user/thread only). Reddit blocked anonymous `.json` in 2026 and gates new API keys to moderation use. `MODE`, `SIGNED`, `signed_status()`.
  - `updater.py` checks `api.github.com/repos/<repo>/tags`, reads CHANGELOG.md at the tag, downloads the codeload
    tarball, validates (safe paths, required files, VERSION == tag), backs up to `.old/`, swaps files, pip-installs if
    requirements changed, smoke-tests, auto-rolls back on failure. `REDDIT_STUDIO_UPDATE_MIRROR` env var points it at a
    test server. CLI: `python updater.py status|check|install|rollback`.
  - `helper.py` Helper panel backend: fixed whitelist of one-click actions (install_signin, signin, signin_status,
    signout, publish, build_installer) run one at a time in a thread with a polled log; `suggestions()` ranks fixes using
    account state + the error text, weighted by learned success rates in `~/.config/reddit-studio/memory.json`
    (also remembers source folder and applied patch files). `publish` git-am's `~/Downloads/reddit-studio-X.Y.Z.patch`
    files newer than VERSION, tags vVERSION, pushes main + tag. Endpoints `/api/helper`, `/api/helper/run/<action>`.
  - API key: `~/.config/reddit-studio/api_key.json` (0600), app-only OAuth via oauth.reddit.com, tried first in `fetch`.
  - `menubar.py` runs the server in-process, polls `updater.STATE["restart_pending"]` and re-execs itself; background
    auto-update thread; Control Center submenu calls `rsctl`.
  - `rsctl` bash Control Center: `rsctl` (clickable list, 23 options) or `rsctl <action>`.
  - `network.py` proxy setting (`~/.config/reddit-studio/network.json`): `network.urlopen` used by reddit_tools and
    updater; sets proxy env vars only while on (restores the originals when off); `test()` checks Reddit via the proxy.
  - `tidy.py` moves only Reddit Studio's own files from ~/Downloads into ~/Reddit Studio Files and prunes old copies;
    `helper.auto_tidy()` runs 12 s after start (so after each update) and after publishing; toggle `tidy_auto` in memory.
  - `static/studio.js` loaded in <head> before the main script: option registry (`O`, saved in `rs_opts`), extra
    themes, explicit mode + `#/explicit` / `#/bookmarks` routes, context menu, Cmd+K palette, lightbox, PIN lock, panic
    key, mods (`rs_mods`), wizard. Hooks in index.html: `Studio.filterPost`, `Studio.cardClass`, `Studio.route`,
    `Studio.opt`, events `rs:feed` / `rs:post`. The main page's const/let globals are read via `G.*` (not window props).
  - `static/views.js` (loaded after the main script) Feed Display Engine: inline views are `v-<mode>` classes on <html>
    (split/compact/grid/masonry/magazine/reader); immersive views build `#rv` (gallery/reels/theater); per-feed view in
    `rs_view_by_feed`. Also hover preview, focus mode, resume scroll, user tags (`rs_tags`), custom feeds (`rs_feeds`,
    route `#/f/<name>` in studio.js), comment tools, download modal. Collections `rs_coll` (`#/c/<name>`), history `#/history`.
  - `media.py` bulk downloader (one job at a time, `/api/media*`), saves to ~/Reddit Studio Files/Media/<feed>/.
  - `templates/index.html` the whole UI (Reader, Tools, Communities, account, phone QR, About/updates).
  - `VERSION` single source of truth. `update.json` names the update repo (`Everything2kayy/reddit-studio`).
- `app/extension/` Chrome MV3 extension (load unpacked from `~/reddit-studio/extension`). `content.js` = shadow-DOM panel
  (Reader/Tools/Tweaks/Dev) using same-origin reddit `.json` with the user's cookies, plus the bridge loop: long-polls
  the app via `background.js` (`/api/bridge/checkin`, `/api/bridge/result/<id>`). `bridge.py` queues app fetches for it;
  `reddit_tools.fetch` uses it after API key / rdt sign-in and before anonymous `.json`/RSS/archive.
- RedGIFs: `redgifs_urls()` (redgifs lib, guest token, 20-min cache); `/api/redgifs/<id>.mp4` redirects to the HD file;
  `norm_post` maps redgifs links to video; tool `redgifs_links`.
- `installer/build.py` → `dist/Reddit-Studio-<version>.zip` (embeds all of `app/` into `Reddit Studio.command`).
- `extras/feed-studio.user.js` userscript for Reddit + X (also served from `app/static/`).

## Next steps (not done yet)
1. Create the GitHub repo and connect updates:
   `gh repo create reddit-studio --public --source . --push`, then set `"repo": "<user>/reddit-studio"` in
   `app/update.json`, bump `app/VERSION` to 2.6.1, add a CHANGELOG entry, commit, `git tag v2.6.1 && git push --tags`.
   Public repo = installed copies can update without GitHub credentials.
2. Install it for real: `python3 installer/build.py`, unzip `dist/…zip` to `~/Downloads`, run
   `cd ~/Downloads/"Reddit Studio" && chmod +x *.command && xattr -cr . && open "Reddit Studio.command"`.
3. Verify on the real Mac (only tested on Linux with mocks so far): rumps menu bar icon, `.app` bundles in
   `~/Applications`, uv-built Python 3.12 venv, rdt-cli signed-in mode against live Reddit, RSS fallback, phone QR.
4. Polish ideas: render release notes Markdown in the About panel (currently plain text); GitHub Action that builds
   the installer zip and attaches it to a Release on each tag.

## Testing
- Mock-based: run the app with `reddit_tools.fetch` / `_get` patched (see git history for test harnesses) or simply
  run `python app/app.py` and use the UI. Updater: serve tarballs from a local HTTP server and set
  `REDDIT_STUDIO_UPDATE_MIRROR=http://127.0.0.1:PORT`.
- Release check before tagging: `python3 -c "import app, reddit_tools, updater"` inside `app/`, and `bash -n app/rsctl`.

## Conventions
- User-facing copy: plain, product-like, no mention of AI assistants.
- Never add write actions (post/vote/message) to Reddit.
- 18+ content stays opt-in and blurred by default.
