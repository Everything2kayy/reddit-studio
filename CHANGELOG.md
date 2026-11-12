# Changelog

## [3.0.0] - 2026-11-12
### Added
- Feed Display Engine: one feed, ten views, picked from the View menu above any feed (or press v to cycle):
  Split pane, Compact, Grid, Masonry (natural image shapes), Magazine (featured layout), Reader (text first),
  Gallery (full screen, arrow keys, slideshow), Reels (full-screen vertical feed that plays what's on screen and
  keeps loading), Theater (big player with the comments beside it) and Smart (picks a view from what's in the feed).
  Each community remembers its own view; columns, uncropped images, hover previews and focus mode (z) are in Settings › Views.
- Bulk media downloader (⬇ above any feed, on posts, or right-click): saves photos, galleries, videos and RedGIFs from a
  community, user, custom feed or post into Reddit Studio Files › Media; re-runs only fetch new files; keeps video sound
  when ffmpeg is installed.
- Custom feeds (combine communities into one feed with its own chip), collections (organize posts into folders),
  reading history, user tags (label and color anyone), resume where you left off in each feed.
- Comment tools: OP-only filter, find in comments, "N new since your last visit", [ and ] to jump between top comments.
- Script console (Settings › Developer) to run JavaScript against the app, and save scripts as mods.
- More right-click actions: add to collection, tag user, download media, add to a custom feed.

## [2.9.0] - 2026-11-12
### Added
- Network settings (Settings › Network): send Reddit Studio's traffic through an HTTP or SOCKS5 proxy, with one-click presets for Tor and Tor Browser, a Test connection button that says whether Reddit answers through it, and Test without proxy for comparison. Off by default; with it off, nothing about your Mac's connection changes.
- Tidy Downloads (Settings › Storage, and the Helper): Reddit Studio's own files — update files, installers, project snapshots, settings exports and your source folder — move out of Downloads into ~/Reddit Studio Files (Updates, Installers, Archive, Exports, Source). Runs automatically after every update, after publishing, and once a day; old copies are pruned (10 update files, 2 installers, 3 snapshots, 3 app backups). Nothing else in Downloads is ever touched.
- The Helper finds new update files in Downloads or in Reddit Studio Files › Updates › Inbox.

## [2.8.0] - 2026-11-12
### Fixed
- Windows (Helper, account, settings and others) now fit the screen and scroll, so they never block the app.
- Sign in with Chrome now checks that Reddit actually accepts the sign-in. If the saved one is stale it clears it and copies a fresh one, and it only reports success when it works.
### Added
- Settings (sliders button, or Cmd+,): 87 searchable settings in 10 sections — Appearance, Feed, Media, Comments, Explicit mode, Privacy, Keyboard, Developer, Mods and Setup.
- 14 new themes (22 in total) with a visual theme picker, plus 5 one-click presets (Reader, Power user, Explicit night, Accessible, Minimal).
- Explicit mode: an 18+ switch with its own #/explicit feed built from your chosen communities, kept out of regular feeds, grid view, media-only filter, its own theme, muted autoplay, reveal-on-hover, and a panic key (`) that hides everything and jumps to a safe page.
- Bookmarks (#/bookmarks), read tracking (dim or hide read posts), muted words, communities and users, highlight words, minimum score and duplicate hiding.
- Right-click menu on posts (13 actions), command palette (Cmd+K), keyboard shortcuts (n/p, o, b, m, g-jumps, ?), fullscreen media viewer with arrow keys, picture-in-picture, playback speed, RedGIFs quality.
- Mods: add your own CSS or JavaScript snippets, with 6 starter mods. Developer tools: View JSON, copy ID and API path, data-source badge, request logging, render timings, live custom CSS, outline mode, settings export/import/reset.
- Privacy: PIN lock, blur when you switch away, ask before outside links, clear history.
- Setup wizard on first launch (theme, start page, explicit mode, Chrome extension).

## [2.7.0] - 2026-11-12
### Added
- Chrome extension (Helper › Add Chrome extension): a Studio panel right on reddit.com with a clean Reader (threaded comments), Tools (page stats, media links, Markdown/JSON/CSV export, keyword highlight), Tweaks (14 page tweaks plus your own live CSS), and Dev tools (page JSON inspector with filter, element picker that copies a CSS selector, layout overlays, activity log). Open it with the orange RS button or Alt+S.
- Chrome link: while a reddit.com tab is open, the app reads through your normal signed-in Chrome when Reddit blocks it directly. The top bar shows "Via Chrome".
- RedGIFs: posts that link to RedGIFs now play in the Reader (still blurred until you choose to show 18+ media), plus a "RedGIFs video links" tool for HD/SD files.

## [2.6.5] - 2026-11-12
### Changed
- Helper suggests Sign in with Chrome first when Reddit blocks you, then trying a different network. Reddit now approves new API keys mainly for moderation tools, so the API key option is tucked away for people who already have one.
### Added
- Archive mode: when Reddit blocks both its data and RSS feeds, communities, user posts, and comment threads load from a public archive copy (Arctic Shift). It can be days or weeks behind and has no live scores; r/popular and r/all aren't available there.

## [2.6.4] - 2026-11-12
### Added
- Helper (magic-wand button in the top bar): one-click actions for everything that used to need Terminal — set up sign-in, sign in with Chrome, check or remove sign-in, build the installer, and publish an update to GitHub.
- Suggestions that learn: the Helper reads what's going wrong and offers the best fix first, remembers what worked, and stops pushing fixes that keep failing.
- Error messages in the reader now come with a one-click fix button.
- Publishing finds new update files in Downloads by itself, applies them, tags the version, and uploads it.

## [2.6.3] - 2026-11-12
### Added
- Use your own Reddit API key (account panel): reads through Reddit's official API, so communities load reliably with scores and comments even when Reddit blocks public data. The key is saved only on your Mac and used read-only.

## [2.6.2] - 2026-11-12
### Fixed
- Public communities like r/popular no longer show "Reddit returned 403" when your sign-in is refused; Reddit Studio falls back to public data instead.

## [2.6.1] - 2026-11-12
### Changed
- Updates are now connected to the official repository, so installed copies can find and install new releases.

## [2.6.0] - 2026-11-12
### Added
- Built-in updater: checks this repository for new releases, shows what's new, installs in place, keeps backups, and rolls back automatically if an update fails.
- Version button in the top bar with an About panel, release notes, and an "Install updates automatically" switch.
- Control Center: a clickable list of 23 options (Applications › Reddit Studio Control Center) and the `rsctl` command.
- Menu bar: update status, Check for Updates, and a Control Center submenu.
- Feed Studio userscript can be installed from the app.

## [2.5.0] - 2026-11-12
### Added
- Sign-in through rdt-cli for full data: Home and Saved feeds, scores, nested comments, sign-in-only communities.

## [2.4.0] - 2026-11-12
### Added
- Menu bar app that runs in the background; Communities directory with favorites and opt-in 18+ section.

## [2.3.0] - 2026-11-12
### Added
- Automatic switch to Reddit's RSS feeds when Reddit blocks public data.

## [2.2.0] - 2026-11-12
### Added
- Phone access by QR code.

## [2.1.0] - 2026-11-12
### Added
- Reader with images, galleries, video with sound, and threaded comments; installable web app.

## [2.0.0] - 2026-11-12
### Added
- Works without Reddit API keys; 37 tools.
