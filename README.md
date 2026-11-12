# Reddit Studio

A Mac app for reading Reddit and analyzing it: a fast reader (feeds, images, video, threaded comments),
37 research and export tools, phone access by QR code, and a menu bar app that keeps it all running in the background.

- **No API keys needed.** Uses Reddit's public feeds, or your own sign-in through [rdt-cli](https://github.com/jackwener/rdt-cli) for full data.
- **Read-only.** It never posts, votes, comments, or messages.
- **Self-updating.** New versions are published as Git tags; the app checks this repository, shows the changelog, and installs updates in place with automatic rollback if anything fails.

## Install

1. Download the latest `Reddit-Studio-<version>.zip` (from Releases, or build it: `python3 installer/build.py`).
2. Unzip it, then in Terminal:
   ```
   cd ~/Downloads/"Reddit Studio" && chmod +x *.command && xattr -cr . && open "Reddit Studio.command"
   ```
3. Reddit Studio moves to the menu bar and opens in your browser. Next time, open it from Applications.

## Everyday use

| Where | What |
| --- | --- |
| Menu bar icon | Open, Tools, Phone QR, update status, Control Center, start at login, quit |
| Version button (top bar) | About, what's new, update now, automatic updates |
| Account button (top bar) | Sign-in status; switch between your sign-in and public data |
| **Reddit Studio Control Center** app | 23 maintenance options in one clickable list |
| `rsctl` in Terminal | Same options from the command line (`rsctl help`) |

## Optional: sign in for full data

```
curl -LsSf https://astral.sh/uv/install.sh | sh     # once, gives a modern Python
uv tool install rdt-cli && rdt login                # copies your Reddit sign-in from Chrome
```
Then run the installer again (or `rsctl repair`). Use a secondary Reddit account; automated access can get accounts restricted.

## Releasing an update

1. Make changes in `app/`, bump `app/VERSION`, add an entry to `CHANGELOG.md`.
2. Commit, then tag and push: `git tag v2.6.1 && git push && git push --tags`.
3. Installed copies pick it up within a few hours (or immediately via **Check for Updates**).

`app/update.json` names the repository the app updates from.

## Project layout

```
app/            the application (copied to ~/reddit-studio on install)
  app.py          web server and API
  reddit_tools.py Reddit data layer (sign-in, public JSON, RSS fallback) and tools
  updater.py      update checks, install, backup and rollback
  menubar.py      macOS menu bar app
  rsctl           Control Center (clickable list and command line)
  templates/      the interface
installer/      builds the double-click installer zip
extras/         Feed Studio userscript for Reddit and X
```

## Credits

Flask, rumps, qrcode, DOMPurify, hls.js, rdt-cli, Google Fonts (Inter, Material Symbols). Interface ideas from Troddit.
