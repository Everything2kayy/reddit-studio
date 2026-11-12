# Changelog

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
