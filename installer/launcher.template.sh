#!/bin/bash
# Reddit Studio installer. Double-click to install or update, then it runs from the menu bar.
APPVER="__VERSION__"
DIR="$HOME/reddit-studio"
PORT=5055
URL="http://127.0.0.1:$PORT"
PID=""

alert()  { osascript -e "display alert \"Reddit Studio\" message \"$1\"" >/dev/null 2>&1; }
notify() { osascript -e "display notification \"$1\" with title \"Reddit Studio\"" >/dev/null 2>&1; }

install_files() {
  mkdir -p "$DIR/templates" "$DIR/static/vendor"
  if [ -d "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
    OLD="$DIR/.old-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$OLD"
    for f in app.py reddit_tools.py updater.py menubar.py requirements.txt VERSION templates/index.html; do
      [ -e "$DIR/$f" ] && cp "$DIR/$f" "$OLD/$(basename "$f")"
    done
  fi
__FILES__
  chmod +x "$DIR/rsctl"
}

install_all() {
  notify "Setting up… this takes about a minute the first time."
  echo "Installing Reddit Studio $APPVER into $DIR"
  install_files || return 1
  # Prefer a modern Python from uv (needed for the optional Reddit sign-in via rdt-cli).
  UV="$(command -v uv 2>/dev/null)"
  [ -z "$UV" ] && [ -x "$HOME/.local/bin/uv" ] && UV="$HOME/.local/bin/uv"
  PYOK="$("$DIR/.venv/bin/python" -c 'import sys; print(int(sys.version_info >= (3, 10)))' 2>/dev/null)"
  if [ -n "$UV" ] && [ "$PYOK" != "1" ]; then
    echo "Setting up Python 3.12 with uv…"
    rm -rf "$DIR/.venv"
    "$UV" venv --seed --python 3.12 "$DIR/.venv" >/dev/null 2>&1 || echo "uv couldn't set up Python 3.12; using the built-in Python."
  fi
  if [ ! -x "$DIR/.venv/bin/python" ]; then
    python3 -m venv "$DIR/.venv" || return 1
  fi
  "$DIR/.venv/bin/python" -m pip install -q --upgrade pip >/dev/null 2>&1
  "$DIR/.venv/bin/python" -m pip install -q -r "$DIR/requirements.txt" || return 1
  "$DIR/.venv/bin/python" -c 'import rdt_cli' >/dev/null 2>&1 \
    && echo "Reddit sign-in support: installed." \
    || echo "Reddit sign-in support: needs Python 3.10+. Install uv (curl -LsSf https://astral.sh/uv/install.sh | sh), then run this installer again."
  "$DIR/.venv/bin/python" -c 'import rumps' >/dev/null 2>&1 || echo "Menu bar icon unavailable; using the window version."
  # `rsctl` command for Terminal
  mkdir -p "$HOME/.local/bin" && ln -sf "$DIR/rsctl" "$HOME/.local/bin/rsctl"
  make_app_bundle
  echo "Install complete."
}

# A tiny app in ~/Applications that runs Reddit Studio from the menu bar, with no Terminal and no Dock icon.
APPB="$HOME/Applications/Reddit Studio.app"
make_app_bundle() {
  mkdir -p "$APPB/Contents/MacOS" "$APPB/Contents/Resources"
  cat > "$APPB/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Reddit Studio</string>
  <key>CFBundleDisplayName</key><string>Reddit Studio</string>
  <key>CFBundleIdentifier</key><string>com.redditstudio.app</string>
  <key>CFBundleExecutable</key><string>reddit-studio</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>__VERSION__</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
  cat > "$APPB/Contents/MacOS/reddit-studio" <<'RUNNER'
#!/bin/bash
cd "$HOME/reddit-studio" || exit 1
exec "$HOME/reddit-studio/.venv/bin/python" "$HOME/reddit-studio/menubar.py" "$@" >> server.log 2>&1
RUNNER
  chmod +x "$APPB/Contents/MacOS/reddit-studio"
  # App icon (best effort, uses built-in macOS tools)
  ICONSET="$(mktemp -d)/AppIcon.iconset"; mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$DIR/static/icon-512.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1
    d=$((s*2)); [ $d -le 512 ] && sips -z $d $d "$DIR/static/icon-512.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null 2>&1
  done
  iconutil -c icns "$ICONSET" -o "$APPB/Contents/Resources/AppIcon.icns" >/dev/null 2>&1
  touch "$APPB"
  # Control Center: a clickable list of every maintenance option
  CCB="$HOME/Applications/Reddit Studio Control Center.app"
  mkdir -p "$CCB/Contents/MacOS" "$CCB/Contents/Resources"
  sed -e 's/<string>Reddit Studio<\/string>/<string>Reddit Studio Control Center<\/string>/g' \
      -e 's/com.redditstudio.app/com.redditstudio.control/' -e 's/<string>reddit-studio<\/string>/<string>control-center<\/string>/' \
      "$APPB/Contents/Info.plist" > "$CCB/Contents/Info.plist"
  printf '#!/bin/bash\nexec /bin/bash "$HOME/reddit-studio/rsctl" menu\n' > "$CCB/Contents/MacOS/control-center"
  chmod +x "$CCB/Contents/MacOS/control-center"
  cp "$APPB/Contents/Resources/AppIcon.icns" "$CCB/Contents/Resources/" 2>/dev/null
  touch "$CCB"
}

# ---------- 1. Python ----------
if ! python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >/dev/null 2>&1; then
  alert "Python 3 is needed. macOS will offer to install the Command Line Tools: click Install, wait for it to finish, then open Reddit Studio again."
  xcode-select --install >/dev/null 2>&1
  exit 1
fi

# ---------- 2. Install or update ----------
if [ "$(cat "$DIR/VERSION" 2>/dev/null)" != "$APPVER" ] || \
   ! (cd "$DIR" 2>/dev/null && .venv/bin/python -c "import flask, reddit_tools" >/dev/null 2>&1); then
  if ! install_all; then
    alert "Setup failed. Scroll up in the Terminal window to see the error."
    exit 1
  fi
fi

# ---------- 3. Run ----------
# Stop any older copy (window version or menu bar version) so the new one takes over.
pkill -f "reddit-studio/menubar.py" 2>/dev/null
lsof -ti tcp:$PORT 2>/dev/null | xargs kill 2>/dev/null
[ -d "$APPB" ] || make_app_bundle

if (cd "$DIR" && .venv/bin/python -c "import rumps" >/dev/null 2>&1); then
  open "$APPB"
  notify "Reddit Studio is running in your menu bar."
  echo "Reddit Studio is now in your menu bar (top right of the screen). You can close this window."
  echo "Next time, open it from Applications > Reddit Studio, or Spotlight (Cmd+Space, type Reddit Studio)."
  echo "Maintenance options: Applications > Reddit Studio Control Center, or type rsctl in Terminal."
  ( sleep 2; osascript -e 'tell application "Terminal" to close (every window whose name contains "Reddit Studio")' >/dev/null 2>&1 ) &
  disown
  exit 0
fi

# Fallback: window version (if the menu bar library couldn't be installed)
start_server() {
  lsof -ti tcp:$PORT 2>/dev/null | xargs kill 2>/dev/null
  cd "$DIR" || exit 1
  .venv/bin/python -m flask --app app run --host 127.0.0.1 --port $PORT > "$DIR/server.log" 2>&1 &
  PID=$!
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "$URL" && return 0
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.25
  done
  tail -20 "$DIR/server.log"
  alert "The app failed to start. The error is shown in the Terminal window."
  exit 1
}
stop_server() { [ -n "$PID" ] && kill "$PID" 2>/dev/null; PID=""; }
trap stop_server EXIT

start_server
open "$URL"
echo "Reddit Studio is running at $URL (keep this window open)."

while true; do
  btn=$(osascript -e "button returned of (display dialog \"Reddit Studio is running.\n\n$URL\" buttons {\"Reinstall\", \"Open in browser\", \"Stop\"} default button 2 with title \"Reddit Studio\")" 2>/dev/null) || btn="Stop"
  case "$btn" in
    "Open in browser") open "$URL" ;;
    "Reinstall") stop_server; install_all || alert "Reinstall failed. See the Terminal window."; start_server; open "$URL" ;;
    *) break ;;
  esac
done

stop_server
notify "Stopped."
exit 0
