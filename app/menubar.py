"""Reddit Studio menu bar app.

Runs the Reddit Studio server in the background and puts an icon in the macOS
menu bar (via the open-source `rumps` library). Closing the browser tab doesn't
stop it; use the menu bar icon to reopen it or quit.
"""
import os
import plistlib
import socket
import subprocess
import sys
import threading
import time
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
sys.path.insert(0, HERE)

PORT = 5055
URL = f"http://127.0.0.1:{PORT}"
APP_BUNDLE = os.path.expanduser("~/Applications/Reddit Studio.app")
AGENT = os.path.expanduser("~/Library/LaunchAgents/com.redditstudio.menubar.plist")


def port_busy():
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def start_server():
    from werkzeug.serving import make_server
    import app as studio
    srv = make_server("127.0.0.1", PORT, studio.app, threaded=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def hide_dock_icon():
    try:
        from AppKit import NSApplication, NSApplicationActivationPolicyAccessory
        NSApplication.sharedApplication().setActivationPolicy_(NSApplicationActivationPolicyAccessory)
    except Exception:
        pass


def login_item_enabled():
    return os.path.exists(AGENT)


def set_login_item(on):
    if not on:
        if os.path.exists(AGENT):
            os.remove(AGENT)
        return
    if os.path.isdir(APP_BUNDLE):
        args = ["/usr/bin/open", APP_BUNDLE, "--args", "--no-browser"]
    else:
        args = [sys.executable, os.path.join(HERE, "menubar.py"), "--no-browser"]
    os.makedirs(os.path.dirname(AGENT), exist_ok=True)
    with open(AGENT, "wb") as f:
        plistlib.dump({"Label": "com.redditstudio.menubar", "ProgramArguments": args,
                       "RunAtLoad": True, "ProcessType": "Interactive"}, f)


RSCTL = os.path.join(HERE, "rsctl")


def ctl(*args):
    """Run a Control Center action (see the rsctl script) without blocking the menu."""
    try:
        subprocess.Popen(["/bin/bash", RSCTL, *args], cwd=HERE,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError:
        pass


def restart_now(srv):
    srv.shutdown()
    srv.server_close()
    os.execv(sys.executable, [sys.executable, os.path.join(HERE, "menubar.py"), "--no-browser"])


def main():
    if port_busy():                 # already running: just show it
        if "--no-browser" not in sys.argv:
            webbrowser.open(URL)
        return
    srv = start_server()
    import updater
    import app as studio
    studio.app.config["CAN_RESTART"] = True
    studio.start_background()

    def background_updates():
        """Check now and every few hours; install automatically if that's switched on."""
        time.sleep(20)
        while True:
            st = updater.check()
            if st["available"] and st["auto_install"] and not st["installing"]:
                updater.install()
            time.sleep(1800)
    threading.Thread(target=background_updates, daemon=True).start()

    try:
        import rumps
    except ImportError:             # no menu bar support: keep serving in the background
        if "--no-browser" not in sys.argv:
            webbrowser.open(URL)
        while True:
            time.sleep(2)
            if updater.STATE["restart_pending"]:
                restart_now(srv)

    import reddit_tools as rt

    class StudioBar(rumps.App):
        def __init__(self):
            icon = os.path.join(HERE, "static", "menubar.png")
            has_icon = os.path.exists(icon)
            super().__init__("Reddit Studio", title=None if has_icon else "RS",
                             icon=icon if has_icon else None, template=True, quit_button=None)
            self.status = rumps.MenuItem("Status: running")
            self.upd = rumps.MenuItem(f"Version {updater.current_version()}", callback=self.update_clicked)
            self.login = rumps.MenuItem("Start at login", callback=self.toggle_login)
            self.login.state = int(login_item_enabled())
            control = rumps.MenuItem("Control Center")
            for title, args in [("Open Control Center window…", ("menu",)),
                                ("Sign in to Reddit…", ("signin",)),
                                ("Check sign-in", ("signin-status",)),
                                ("Sign out of Reddit", ("signout",)),
                                (None, None),
                                ("Restart Reddit Studio", ("restart",)),
                                ("Roll back to previous version", ("rollback",)),
                                ("Repair (reinstall dependencies)", ("repair",)),
                                ("Run installer from Downloads", ("installer",)),
                                (None, None),
                                ("Show log", ("log",)),
                                ("Open data folder", ("folder",)),
                                ("Install Feed Studio browser add-on", ("userscript",))]:
                if title is None:
                    control.add(None)
                else:
                    control.add(rumps.MenuItem(title, callback=lambda _, a=args: ctl(*a)))
            self.menu = [
                rumps.MenuItem("Open Reddit Studio", callback=self.open_reader, key="o"),
                rumps.MenuItem("Open Tools", callback=self.open_tools, key="t"),
                rumps.MenuItem("Phone access (QR code)…", callback=self.open_phone),
                None,
                self.status,
                self.upd,
                rumps.MenuItem("Check for Updates…", callback=self.check_updates),
                None,
                control,
                self.login,
                None,
                rumps.MenuItem("Quit Reddit Studio", callback=self.quit_app, key="q"),
            ]
            self.timer = rumps.Timer(self.refresh, 3)
            self.timer.start()

        def refresh(self, _=None):
            hide_dock_icon()
            if updater.STATE["restart_pending"]:
                restart_now(srv)
            st = rt.signed_status()
            if st["available"]:
                self.status.title = f"Signed in as u/{st['user'] or '?'}"
            elif rt.MODE["rss"]:
                self.status.title = "Status: limited mode (RSS feeds)"
            else:
                self.status.title = "Status: public mode"
            u = updater.status()
            if u["installing"]:
                self.upd.title = "Installing update…"
            elif u["available"]:
                self.upd.title = f"Update available: {u['latest']} (click to install)"
            else:
                self.upd.title = f"Version {u['current']} · up to date" if u["checked_at"] else f"Version {u['current']}"

        def update_clicked(self, _):
            u = updater.status()
            if u["available"] and not u["installing"]:
                self.install_update(u)

        def install_update(self, u):
            notes = (u["notes"] or "")[:900]
            if rumps.alert(f"Update to {u['latest']}?", notes or "A new version is ready.",
                           ok="Install & Restart", cancel="Later") == 1:
                threading.Thread(target=updater.install, daemon=True).start()
                rumps.notification("Reddit Studio", "Installing update…", "It restarts by itself when done.")

        def check_updates(self, _):
            u = updater.check(force=True)
            if u["error"]:
                rumps.alert("Couldn't check for updates", u["error"])
            elif u["available"]:
                self.install_update(u)
            else:
                rumps.alert("You're up to date", f"Reddit Studio {u['current']} is the latest version.")

        def open_reader(self, _):
            webbrowser.open(URL + "/#/r/popular")

        def open_tools(self, _):
            webbrowser.open(URL + "/#/tools")

        def open_phone(self, _):
            webbrowser.open(URL + "/?phone=1#/r/popular")

        def toggle_login(self, item):
            try:
                set_login_item(not item.state)
                item.state = int(login_item_enabled())
            except OSError as e:
                rumps.alert("Reddit Studio", f"Couldn't change the login setting: {e}")

        def quit_app(self, _):
            threading.Thread(target=srv.shutdown, daemon=True).start()
            rumps.quit_application()

    hide_dock_icon()
    bar = StudioBar()
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(URL + "/#/r/popular")).start()
    bar.run()


if __name__ == "__main__":
    main()
