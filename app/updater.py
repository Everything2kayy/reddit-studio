"""Reddit Studio updater.

Checks the project's GitHub repository for a newer tagged release (vX.Y.Z),
shows its changelog, and installs it in place:

  1. download the release tarball over HTTPS from GitHub
  2. validate it (safe paths, required files, version matches the tag)
  3. back up the current version to .old/<version>-<timestamp>/
  4. copy the new files in, install changed dependencies
  5. smoke-test the new code; roll back automatically if anything fails

Command line:  python updater.py [status|check|install|rollback]
"""
import json
import network
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

HERE = os.path.dirname(os.path.abspath(__file__))
BACKUPS = os.path.join(HERE, ".old")
USER_SETTINGS = os.path.join(HERE, ".user-settings.json")
REQUIRED = ["app.py", "helper.py", "bridge.py", "network.py", "tidy.py", "media.py", "reddit_tools.py", "menubar.py", "updater.py", "VERSION",
            "requirements.txt", "templates/index.html"]
KEEP = {".venv", ".old", ".user-settings.json", "server.log"}   # never touched by updates
UA = "reddit-studio-updater"

STATE = {"checked_at": 0, "latest": None, "tag": None, "notes": "", "error": None,
         "installing": False, "result": None, "restart_pending": False}
_lock = threading.Lock()


# ---------- settings ----------
def _json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def config():
    cfg = {"repo": "", "auto_install": True, "check_hours": 6}
    cfg.update(_json(os.path.join(HERE, "update.json"), {}))
    cfg.update(_json(USER_SETTINGS, {}))
    return cfg


def save_user_setting(key, value):
    s = _json(USER_SETTINGS, {})
    s[key] = value
    with open(USER_SETTINGS, "w") as f:
        json.dump(s, f, indent=2)


def repo():
    r = str(config().get("repo") or "").strip()
    return r if re.fullmatch(r"[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+", r) and not r.startswith("OWNER/") else ""


def current_version():
    try:
        with open(os.path.join(HERE, "VERSION")) as f:
            return f.read().strip()
    except OSError:
        return "0.0.0"


def vtuple(s):
    nums = [int(x) for x in re.findall(r"\d+", str(s))[:3]]
    return tuple(nums + [0] * (3 - len(nums)))


# ---------- network ----------
API = "https://api.github.com"
CODELOAD = "https://codeload.github.com"
RAW = "https://raw.githubusercontent.com"
if os.environ.get("REDDIT_STUDIO_UPDATE_MIRROR"):        # testing / private mirror
    API = CODELOAD = RAW = os.environ["REDDIT_STUDIO_UPDATE_MIRROR"].rstrip("/")


def _get(url, timeout=25):
    req = Request(url, headers={"User-Agent": UA, "Accept": "application/vnd.github+json"})
    with network.urlopen(req, timeout=timeout) as r:
        return r.read()


def latest_release():
    """Highest vX.Y.Z tag in the repository."""
    tags = json.loads(_get(f"{API}/repos/{repo()}/tags?per_page=100"))
    versions = [(vtuple(t["name"]), t["name"]) for t in tags
                if re.fullmatch(r"v?\d+\.\d+\.\d+", t.get("name", ""))]
    if not versions:
        return None, None
    v, tag = max(versions)
    return ".".join(map(str, v)), tag


def release_notes(tag, since):
    """Changelog sections newer than `since`, from the tagged CHANGELOG.md."""
    try:
        text = _get(f"{RAW}/{repo()}/{tag}/CHANGELOG.md").decode("utf-8", "replace")
    except (HTTPError, URLError, OSError):
        return ""
    out, keep = [], False
    for line in text.splitlines():
        m = re.match(r"##\s*\[?v?(\d+\.\d+\.\d+)\]?", line)
        if m:
            keep = vtuple(m.group(1)) > vtuple(since)
        if keep:
            out.append(line)
    return "\n".join(out).strip()


# ---------- check ----------
def status():
    cur = current_version()
    latest = STATE["latest"]
    cfg = config()
    return {"current": cur, "latest": latest, "tag": STATE["tag"],
            "available": bool(latest and vtuple(latest) > vtuple(cur)),
            "notes": STATE["notes"], "error": STATE["error"], "repo": repo(),
            "configured": bool(repo()), "auto_install": bool(cfg.get("auto_install")),
            "checked_at": STATE["checked_at"], "installing": STATE["installing"],
            "result": STATE["result"], "restart_pending": STATE["restart_pending"]}


def check(force=False):
    if not repo():
        STATE["error"] = "Updates aren't connected to a repository yet."
        return status()
    hours = float(config().get("check_hours") or 6)
    if not force and time.time() - STATE["checked_at"] < hours * 3600:
        return status()
    try:
        latest, tag = latest_release()
        STATE.update(latest=latest, tag=tag, error=None, checked_at=time.time())
        STATE["notes"] = release_notes(tag, current_version()) if latest and vtuple(latest) > vtuple(current_version()) else ""
    except HTTPError as e:
        STATE["error"] = ("Couldn't find the update repository (404)." if e.code == 404
                          else "GitHub is limiting update checks right now; try again later." if e.code in (403, 429)
                          else f"Update check failed (HTTP {e.code}).")
    except (URLError, OSError, ValueError) as e:
        STATE["error"] = f"Couldn't reach GitHub to check for updates ({e})."
    return status()


# ---------- install ----------
def _safe_extract(tar_path, dest):
    with tarfile.open(tar_path, "r:gz") as tf:
        for m in tf.getmembers():
            name = m.name
            if name.startswith("/") or ".." in name.split("/") or m.issym() or m.islnk() or m.isdev():
                raise RuntimeError(f"Update package contains an unsafe entry: {name}")
        tf.extractall(dest)
    roots = [d for d in os.listdir(dest) if os.path.isdir(os.path.join(dest, d))]
    if len(roots) != 1:
        raise RuntimeError("Update package has an unexpected layout.")
    return os.path.join(dest, roots[0])


def _app_files(base):
    for root, dirs, files in os.walk(base):
        rel_root = os.path.relpath(root, base)
        if rel_root == ".":
            dirs[:] = [d for d in dirs if d not in KEEP and d != "__pycache__"]
        else:
            dirs[:] = [d for d in dirs if d != "__pycache__"]
        for f in files:
            rel = os.path.normpath(os.path.join(rel_root, f))
            if rel.split(os.sep)[0] in KEEP or f.endswith(".pyc"):
                continue
            yield rel


def _copy_tree(src, dst):
    for rel in _app_files(src):
        target = os.path.join(dst, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copy2(os.path.join(src, rel), target)


def _backup():
    path = os.path.join(BACKUPS, f"{current_version()}-{time.strftime('%Y%m%d-%H%M%S')}")
    os.makedirs(path, exist_ok=True)
    _copy_tree(HERE, path)
    # keep the 5 most recent backups
    olds = sorted(os.listdir(BACKUPS), key=lambda d: os.path.getmtime(os.path.join(BACKUPS, d)))
    for d in olds[:-5]:
        shutil.rmtree(os.path.join(BACKUPS, d), ignore_errors=True)
    return path


def _restore(path):
    for rel in list(_app_files(HERE)):          # remove files the backup doesn't have
        if not os.path.exists(os.path.join(path, rel)):
            os.remove(os.path.join(HERE, rel))
    _copy_tree(path, HERE)


def _direct_env():
    """Environment without proxy variables (pip can't use a SOCKS proxy from the environment)."""
    return {k: v for k, v in os.environ.items() if k.lower() not in ("http_proxy", "https_proxy", "all_proxy")}


def _pip(req_file):
    return subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", req_file],
                          capture_output=True, text=True, timeout=900, env=_direct_env())


def _smoke_test():
    return subprocess.run([sys.executable, "-c", "import app, reddit_tools, updater; "
                           "c = app.app.test_client(); assert c.get('/api/tools').status_code == 200"],
                          cwd=HERE, capture_output=True, text=True, timeout=120, env=_direct_env())


def install(tag=None):
    """Install the given (or latest) release. Returns a result dict; never raises."""
    if not _lock.acquire(blocking=False):
        return {"ok": False, "error": "An update is already being installed."}
    STATE.update(installing=True, result=None)
    backup = None
    try:
        if not repo():
            raise RuntimeError("Updates aren't connected to a repository yet.")
        if not tag:
            check(force=True)
            if STATE["error"]:
                raise RuntimeError(STATE["error"])
            if not status()["available"]:
                return _done({"ok": True, "updated": False, "version": current_version(),
                              "message": "You're on the latest version."})
            tag = STATE["tag"]
        new_version = ".".join(map(str, vtuple(tag)))
        with tempfile.TemporaryDirectory() as tmp:
            tar_path = os.path.join(tmp, "release.tar.gz")
            with open(tar_path, "wb") as f:
                f.write(_get(f"{CODELOAD}/{repo()}/tar.gz/refs/tags/{tag}", timeout=120))
            root = _safe_extract(tar_path, os.path.join(tmp, "x"))
            src = os.path.join(root, "app")
            missing = [r for r in REQUIRED if not os.path.exists(os.path.join(src, r))]
            if missing:
                raise RuntimeError(f"Release {tag} is missing files: {', '.join(missing)}")
            with open(os.path.join(src, "VERSION")) as f:
                pkg_version = f.read().strip()
            if vtuple(pkg_version) != vtuple(tag):
                raise RuntimeError(f"Release {tag} says it's version {pkg_version}; refusing to install.")
            old_req = open(os.path.join(HERE, "requirements.txt")).read() if os.path.exists(
                os.path.join(HERE, "requirements.txt")) else ""
            backup = _backup()
            _restore(src)                       # copies the new release in, removes stale files
            if open(os.path.join(HERE, "requirements.txt")).read() != old_req:
                r = _pip(os.path.join(HERE, "requirements.txt"))
                if r.returncode != 0:
                    raise RuntimeError("Installing new dependencies failed:\n" + r.stderr[-800:])
            r = _smoke_test()
            if r.returncode != 0:
                raise RuntimeError("The new version failed its self-test:\n" + r.stderr[-800:])
        STATE.update(restart_pending=True, notes="")
        return _done({"ok": True, "updated": True, "version": new_version, "backup": backup,
                      "message": f"Updated to {new_version}. Restarting…"})
    except Exception as e:
        if backup:
            try:
                _restore(backup)
            except Exception as re_err:
                return _done({"ok": False, "error": f"{e}\n\nRollback also failed: {re_err}. "
                                                    f"Your previous version is saved in {backup}."})
            return _done({"ok": False, "error": f"{e}\n\nNothing changed: the previous version was restored."})
        return _done({"ok": False, "error": str(e)})
    finally:
        STATE["installing"] = False
        _lock.release()


def _done(result):
    STATE["result"] = result
    return result


def rollback():
    if not os.path.isdir(BACKUPS) or not os.listdir(BACKUPS):
        return {"ok": False, "error": "There's no earlier version saved."}
    latest = max(os.listdir(BACKUPS), key=lambda d: os.path.getmtime(os.path.join(BACKUPS, d)))
    path = os.path.join(BACKUPS, latest)
    _restore(path)
    shutil.rmtree(path, ignore_errors=True)
    STATE["restart_pending"] = True
    return {"ok": True, "version": current_version(), "message": f"Rolled back to {current_version()}."}


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "check":
        out = check(force=True)
    elif cmd == "install":
        out = install(sys.argv[2] if len(sys.argv) > 2 else None)
    elif cmd == "rollback":
        out = rollback()
    else:
        out = check()
    print(json.dumps(out, indent=2))
    sys.exit(0 if out.get("ok", True) and not out.get("error") else 1)
