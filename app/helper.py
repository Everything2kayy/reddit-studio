"""Helper: one-click versions of the Terminal steps, plus suggestions that learn.

Every action is a fixed, built-in command (nothing typed by the user is ever run as
a command). Actions run one at a time in the background; the UI polls their output.

Memory (~/.config/reddit-studio/memory.json) remembers what it learns:
  - where your source folder is, which patch files were already published,
  - how often each fix worked, so suggestions that keep failing drop down the list
    and the next-best fix is offered instead.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
MEM_FILE = os.path.expanduser("~/.config/reddit-studio/memory.json")
HOME = os.path.expanduser("~")
DOWNLOADS = os.path.join(HOME, "Downloads")

_lock = threading.Lock()
JOB = {"id": None, "title": "", "running": False, "ok": None, "log": "", "started": 0.0, "ended": 0.0}


# ---------- memory ----------
def _mem():
    try:
        with open(MEM_FILE) as f:
            m = json.load(f)
            if isinstance(m, dict):
                return m
    except (OSError, ValueError):
        pass
    return {}


def _save_mem(m):
    os.makedirs(os.path.dirname(MEM_FILE), exist_ok=True)
    tmp = MEM_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(m, f, indent=1)
    os.replace(tmp, MEM_FILE)


def remember(**kv):
    m = _mem()
    m.update(kv)
    _save_mem(m)


def _score(action, ok):
    m = _mem()
    s = m.setdefault("scores", {}).setdefault(action, {"ok": 0, "fail": 0, "last": 0})
    s["ok" if ok else "fail"] += 1
    s["last"] = time.time()
    s["last_ok"] = ok
    _save_mem(m)


def _trust(action):
    """0..1: how well this fix has worked before. New fixes start optimistic."""
    s = _mem().get("scores", {}).get(action)
    if not s:
        return 0.8
    return (s["ok"] + 1) / (s["ok"] + s["fail"] + 1.25)


# ---------- tools on this Mac ----------
def _venv_bin(name):
    p = os.path.join(os.path.dirname(sys.executable), name)
    return p if os.path.exists(p) else None


def _rdt():
    return _venv_bin("rdt") or shutil.which("rdt")


def _git():
    return shutil.which("git") or ("/usr/bin/git" if os.path.exists("/usr/bin/git") else None)


def _is_source(path):
    return (os.path.isdir(os.path.join(path, ".git")) and
            os.path.exists(os.path.join(path, "app", "update.json")) and
            os.path.exists(os.path.join(path, "installer", "build.py")))


def source_dir():
    """Find the Reddit Studio source folder (the git copy you publish from), and remember it."""
    m = _mem()
    p = m.get("source_dir")
    if p and _is_source(p):
        return p
    cands = [os.path.join(DOWNLOADS, "reddit-studio"), os.path.join(HOME, "reddit-studio-src"),
             os.path.join(HOME, "Developer", "reddit-studio"), os.path.join(HOME, "Documents", "reddit-studio")]
    cands += glob.glob(os.path.join(HOME, "*", "reddit-studio")) + glob.glob(os.path.join(HOME, "*", "*", "reddit-studio"))
    for c in cands:
        if _is_source(c):
            remember(source_dir=c)
            return c
    return None


def _ver_key(name):
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", name)
    return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)


def pending_patches():
    """Update files (reddit-studio-X.Y.Z.patch) in Downloads that haven't been published yet."""
    done = set(_mem().get("applied_patches", []))
    src = source_dir()
    cur = _ver_key(_read(os.path.join(src, "app", "VERSION"))) if src else (0, 0, 0)
    out = []
    for p in glob.glob(os.path.join(DOWNLOADS, "reddit-studio*.patch")):
        name = os.path.basename(p)
        if name in done or _ver_key(name) <= cur:
            continue
        out.append(p)
    return sorted(out, key=lambda p: _ver_key(os.path.basename(p)))


def _read(p):
    try:
        with open(p) as f:
            return f.read().strip()
    except OSError:
        return ""


# ---------- running actions ----------
def _log(text):
    with _lock:
        JOB["log"] += text
        if len(JOB["log"]) > 60000:
            JOB["log"] = "…\n" + JOB["log"][-50000:]


def _run(cmd, cwd=None, timeout=900, env=None):
    _log("$ " + " ".join(os.path.basename(c) if i == 0 else c for i, c in enumerate(cmd)) + "\n")
    try:
        p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             stdin=subprocess.DEVNULL, text=True, env={**os.environ, "GIT_TERMINAL_PROMPT": "0", **(env or {})})
    except OSError as e:
        _log(f"Couldn't start it: {e}\n")
        return 1
    t0 = time.time()
    for line in p.stdout:
        _log(line)
        if time.time() - t0 > timeout:
            p.kill()
            _log("Stopped: it took too long.\n")
            return 1
    return p.wait()


def _start(action, title, fn):
    with _lock:
        if JOB["running"]:
            raise RuntimeError(f"Still working on “{JOB['title']}”. Wait for it to finish.")
        JOB.update(id=action, title=title, running=True, ok=None, log="", started=time.time(), ended=0.0)

    def go():
        ok = False
        try:
            ok = bool(fn())
        except Exception as e:
            _log(f"\nSomething went wrong: {e}\n")
        with _lock:
            JOB.update(running=False, ok=ok, ended=time.time())
        _log("\n" + ("Done." if ok else "That didn't work. Details are above.") + "\n")
        _score(action, ok)
        hist = _mem().get("history", [])[-29:]
        remember(history=hist + [{"action": action, "ok": ok, "at": time.time()}])
        for cb in AFTER:
            try:
                cb(action, ok)
            except Exception:
                pass

    threading.Thread(target=go, daemon=True).start()
    return status()


AFTER = []   # callbacks(action, ok) registered by the app, e.g. to clear caches


# --- the actions ---
def _install_signin():
    if _rdt():
        _log("The sign-in tool is already installed.\n")
        return True
    if sys.version_info < (3, 10):
        _log("Sign-in needs a newer Python than this install has. Run the Reddit Studio installer again "
             "(it sets up a newer Python automatically), then try this button again.\n")
        return False
    return _run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "rdt-cli"]) == 0 and bool(_rdt())


def _rdt_authenticated():
    """True/False from `rdt status`, or None if it couldn't tell."""
    try:
        out = subprocess.run([_rdt(), "status"], capture_output=True, text=True, timeout=60).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None, ""
    _log(out if out.endswith("\n") else out + "\n")
    m = re.search(r"authenticated:\s*(true|false)", out, re.I)
    err = re.search(r"error:\s*'?([^'\n]+)", out)
    return (m.group(1).lower() == "true") if m else None, (err.group(1) if err else "")


def _signin():
    if not _rdt() and not _install_signin():
        return False
    _log("\nCopying your Reddit sign-in from Chrome. If macOS asks for your password to let it read "
         "Chrome's saved data, choose Allow.\n\n")
    _run([_rdt(), "login"], timeout=300)
    ok, err = _rdt_authenticated()
    if ok is not True:
        _log("\nThe saved sign-in isn't accepted by Reddit" + (f" ({err})" if err else "") +
             ". Clearing it and copying a fresh one…\n\n")
        _run([_rdt(), "logout"], timeout=60)
        _run([_rdt(), "login"], timeout=300)
        ok, err = _rdt_authenticated()
    if ok is True:
        _log("\nSigned in. Reddit Studio now reads with your account.\n")
        return True
    _log("\nReddit still refuses this sign-in" + (f" ({err})" if err else "") + ".\n"
         "Try this: in Chrome, open reddit.com, log out, log back in, then click Sign in with Chrome again.\n"
         "Or use the Chrome extension (Helper › Add Chrome extension) — it reads through your open Chrome tab "
         "and doesn't need this sign-in at all.\n")
    return False


def _signout():
    if not _rdt():
        _log("Not signed in.\n")
        return True
    return _run([_rdt(), "logout"], timeout=60) == 0


def _signin_status():
    if not _rdt():
        _log("The sign-in tool isn't installed yet.\n")
        return False
    return _run([_rdt(), "status"], timeout=60) == 0


def _publish():
    git, src = _git(), source_dir()
    if not git:
        _log("Git isn't installed. macOS will offer to install it the first time it's needed: "
             "open the Terminal app once and type git, then try again.\n")
        return False
    if not src:
        _log("Couldn't find your Reddit Studio source folder (the one with the .git folder). "
             "Unzip the project into Downloads as “reddit-studio”, then try again.\n")
        return False
    _log(f"Source folder: {src}\n")
    ident = {}
    if not subprocess.run([git, "config", "user.name"], cwd=src, capture_output=True, text=True).stdout.strip():
        ident = {"GIT_COMMITTER_NAME": "Reddit Studio", "GIT_COMMITTER_EMAIL": "reddit-studio@localhost"}
    patches = pending_patches()
    if patches:
        _run([git, "am", "--abort"], cwd=src, timeout=30) if os.path.isdir(os.path.join(src, ".git", "rebase-apply")) else None
    for p in patches:
        name = os.path.basename(p)
        _log(f"\nApplying {name}…\n")
        if _run([git, "am", "--3way", p], cwd=src, timeout=120, env=ident) != 0:
            _run([git, "am", "--abort"], cwd=src, timeout=30)
            if _run([git, "apply", "--check", "-R", p], cwd=src, timeout=30) == 0:
                _log(f"{name} is already included; skipping it.\n")
            else:
                _log(f"{name} doesn't fit this folder. Nothing was changed.\n")
                return False
        m = _mem()
        remember(applied_patches=sorted(set(m.get("applied_patches", [])) | {name}))
    ver = _read(os.path.join(src, "app", "VERSION"))
    if not re.fullmatch(r"\d+\.\d+\.\d+", ver):
        _log(f"app/VERSION doesn't look like a version ({ver!r}).\n")
        return False
    tag = "v" + ver
    have = subprocess.run([git, "tag", "-l", tag], cwd=src, capture_output=True, text=True).stdout.strip()
    if not have:
        _log(f"\nTagging {tag}\n")
        if _run([git, "tag", tag], cwd=src, timeout=30, env=ident) != 0:
            return False
    _log("\nUploading to GitHub…\n")
    if _run([git, "push", "-u", "origin", "HEAD:main"], cwd=src, timeout=300) != 0:
        _log("\nGitHub didn't accept the upload. If it's a sign-in problem, push once from Terminal so "
             "your Mac saves your GitHub token, then this button will work from then on.\n")
        return False
    if _run([git, "push", "origin", tag], cwd=src, timeout=300) != 0:
        return False
    remember(last_published=tag)
    _log(f"\nPublished {tag}. Installed copies will pick it up on their next update check.\n")
    return True


def _build_installer():
    src = source_dir()
    if not src:
        _log("Couldn't find your Reddit Studio source folder.\n")
        return False
    ok = _run([sys.executable, os.path.join(src, "installer", "build.py")], cwd=src, timeout=300) == 0
    if ok:
        dist = os.path.join(src, "dist")
        _log(f"\nThe installer is in {dist}\n")
        subprocess.Popen(["open", dist], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) if sys.platform == "darwin" else None
    return ok


def _extension():
    ext = os.path.join(HERE, "extension")
    if not os.path.exists(os.path.join(ext, "manifest.json")):
        _log("The extension folder is missing from this install. Update Reddit Studio, then try again.\n")
        return False
    _log("Add the Reddit Studio extension to Chrome (one time):\n\n"
         "  1. In Chrome, open the address chrome://extensions\n"
         "  2. Turn on Developer mode (top right).\n"
         "  3. Click Load unpacked, then choose this folder:\n"
         f"     {ext}\n"
         "     (A Finder window with it just opened. In the file picker, press Cmd+Shift+G and paste the path.)\n"
         "  4. Open any reddit.com page. An orange RS button appears bottom right (or press Alt+S).\n\n"
         "After Reddit Studio updates, click the reload arrow on the extension's card in chrome://extensions.\n")
    if sys.platform == "darwin":
        subprocess.Popen(["open", ext], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    remember(extension_shown=time.time())
    return True


ACTIONS = {
    "extension": ("Add Chrome extension", _extension),
    "install_signin": ("Set up Reddit sign-in", _install_signin),
    "signin": ("Sign in with Chrome", _signin),
    "signin_status": ("Check sign-in", _signin_status),
    "signout": ("Sign out", _signout),
    "publish": ("Publish update to GitHub", _publish),
    "build_installer": ("Build installer", _build_installer),
}


def run(action):
    if action not in ACTIONS:
        raise ValueError("Unknown action.")
    title, fn = ACTIONS[action]
    return _start(action, title, fn)


def status():
    with _lock:
        return dict(JOB)


# ---------- suggestions ----------
def suggestions(account, err_hint=""):
    """What to do next, best first. `account` is reddit_tools.signed_status()."""
    out = []

    def add(action, title, why, base, kind="action"):
        out.append({"action": action, "title": title, "why": why, "kind": kind,
                    "score": round(base * (_trust(action) if kind == "action" else 1), 3)})

    api = account.get("api") or {}
    err = account.get("error") or ""
    hint = (err_hint or "").lower()
    blocked = account.get("rss") or bool(err) or any(
        w in hint for w in ("403", "blocking", "couldn't reach", "refused"))
    signed = account.get("cred_file")
    if api.get("configured") and api.get("error"):
        add("apikey", "Fix your API key", api["error"], 0.95, kind="panel")
    if signed and ("403" in err or "expired" in err or "refused" in hint):
        add("signin", "Refresh your Reddit sign-in", "Reddit refused your saved sign-in. Signing in again usually fixes it.", 0.92)
    if not signed:
        if _rdt():
            add("signin", "Sign in with Chrome",
                "Reads with your own Reddit account: full data, Home feed and Saved posts. Log into Reddit in Chrome first.",
                0.9 if blocked else 0.5)
        else:
            add("install_signin", "Set up Reddit sign-in",
                "One-time setup so Reddit Studio can read with your Reddit account.", 0.88 if blocked else 0.45)
    br = account.get("bridge") or {}
    if blocked and not br.get("connected"):
        add("extension", "Add the Chrome extension",
            "Reads Reddit through your normal Chrome tab, so blocks on the app don't matter. Keep one reddit.com tab open.",
            0.89 if not _mem().get("extension_shown") else 0.7)
    if blocked:
        add("network", "Try a different network",
            "Reddit sometimes blocks a whole home connection. Switch to your phone's hotspot for a minute, then click Try again.",
            0.6, kind="info")
    pp = pending_patches()
    if pp:
        names = ", ".join(os.path.basename(p) for p in pp)
        add("publish", "Publish the new update", f"Found {names} in Downloads.", 0.8)

    # learned: if the same fix just failed twice in a row, push it down and say so
    hist = _mem().get("history", [])
    for s in out:
        recent = [h for h in hist if h["action"] == s["action"]][-2:]
        if len(recent) == 2 and not any(h["ok"] for h in recent):
            s["score"] *= 0.4
            s["why"] += " (This failed the last two times; check the details before trying again.)"
    out.sort(key=lambda s: -s["score"])
    return out


def overview(account, err_hint=""):
    src = source_dir()
    return {"job": status(), "suggestions": suggestions(account, err_hint),
            "source_dir": src, "pending_patches": [os.path.basename(p) for p in pending_patches()],
            "has_signin_tool": bool(_rdt()), "has_git": bool(_git()),
            "last_published": _mem().get("last_published"),
            "actions": [{"id": k, "title": v[0]} for k, v in ACTIONS.items()]}
