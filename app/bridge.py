"""Chrome extension bridge.

When the Reddit Studio extension is installed and a reddit.com tab is open, the
extension checks in here every second or so. If Reddit blocks the app's own
requests, the app hands the request to the extension, which loads the same
reddit.com .json address inside your normal, signed-in Chrome tab and sends the
answer back. Only read-only GET requests for reddit.com paths are ever handed over.
"""
import itertools
import re
import threading
import time

ALIVE_FOR = 20         # seconds since the last check-in that still counts as connected
WAIT = 20              # seconds to wait for the extension to answer

_lock = threading.Lock()
_cond = threading.Condition(_lock)
HOLD = 8              # the extension's check-in waits up to this long for work (long poll)
_ids = itertools.count(1)
_jobs = {}             # id -> {"path", "event", "result", "error", "taken"}
STATE = {"seen": 0.0, "version": "", "tab": "", "user": "", "served": 0, "failed": 0, "last_error": ""}
SAFE_PATH = re.compile(r"^/[A-Za-z0-9_/\-.]*$")


def alive():
    return time.time() - STATE["seen"] < ALIVE_FOR


def status():
    return {"connected": alive(), "version": STATE["version"], "user": STATE["user"],
            "served": STATE["served"], "failed": STATE["failed"],
            "last_seen": STATE["seen"] or None}


def checkin(version="", tab="", user=""):
    """Called by the extension. Returns the requests waiting for it."""
    STATE.update(seen=time.time(), version=str(version)[:20], tab=str(tab)[:200], user=str(user)[:40])
    out = []
    end = time.time() + HOLD
    with _cond:
        while True:
            for jid, j in _jobs.items():
                if not j["taken"]:
                    j["taken"] = True
                    out.append({"id": jid, "url": j["url"]})
            left = end - time.time()
            if out or left <= 0:
                break
            _cond.wait(left)
    STATE["seen"] = time.time()
    return {"jobs": out}


def deliver(jid, data=None, error=None, status_code=None):
    with _lock:
        j = _jobs.get(int(jid))
    if not j:
        return {"ok": False}
    j["result"], j["error"], j["status"] = data, error, status_code
    j["event"].set()
    return {"ok": True}


def fetch(url_path):
    """Ask the extension to load https://www.reddit.com<url_path>. Returns parsed JSON,
    or raises RuntimeError. Returns None when the extension isn't connected."""
    if not alive() or not url_path.startswith("/") or not SAFE_PATH.match(url_path.split("?")[0]):
        return None
    jid = next(_ids)
    ev = threading.Event()
    with _cond:
        _jobs[jid] = {"url": url_path, "event": ev, "result": None, "error": None, "status": None, "taken": False}
        _cond.notify_all()
    try:
        if not ev.wait(WAIT):
            STATE["failed"] += 1
            STATE["last_error"] = "the reddit.com tab didn't answer"
            return None
        j = _jobs[jid]
        if j["error"] or j["result"] is None:
            STATE["failed"] += 1
            code = j.get("status")
            if code == 404:
                raise RuntimeError("Reddit says that doesn't exist (404). Check the spelling.")
            STATE["last_error"] = f"HTTP {code}" if code else (j["error"] or "no answer")
            return None
        STATE["served"] += 1
        return j["result"]
    finally:
        with _lock:
            _jobs.pop(jid, None)
