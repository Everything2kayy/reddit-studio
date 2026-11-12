"""Network settings: send Reddit Studio's internet requests through a proxy.

Saved in ~/.config/reddit-studio/network.json. Supports HTTP(S) proxies and SOCKS5
(for example Tor: socks5://127.0.0.1:9050, or Tor Browser: socks5://127.0.0.1:9150).
Requests to this computer (127.0.0.1 / localhost) never go through the proxy.
"""
import json
import os
import re
import time
from urllib.request import ProxyHandler, Request, build_opener

CFG_FILE = os.path.expanduser("~/.config/reddit-studio/network.json")
PRESETS = [
    {"id": "tor", "label": "Tor (installed with Homebrew: brew install tor)", "url": "socks5://127.0.0.1:9050"},
    {"id": "torbrowser", "label": "Tor Browser (while it's open)", "url": "socks5://127.0.0.1:9150"},
    {"id": "http", "label": "HTTP proxy on this Mac (for example port 8080)", "url": "http://127.0.0.1:8080"},
]
URL_RE = re.compile(r"^(https?|socks5h?|socks4)://([^\s:/@]+(:[^\s:/@]*)?@)?[A-Za-z0-9.\-\[\]:]+:\d{1,5}/?$")
_opener = {"key": None, "opener": None}
STATE = {"last_test": None}


def config():
    try:
        with open(CFG_FILE) as f:
            c = json.load(f)
            if isinstance(c, dict):
                return {"on": bool(c.get("on")), "url": str(c.get("url") or "")}
    except (OSError, ValueError):
        pass
    return {"on": False, "url": ""}


def proxy_url():
    c = config()
    return c["url"] if c["on"] and c["url"] else None


def _socks_available():
    try:
        import socks  # noqa: F401  (PySocks)
        return True
    except ImportError:
        return False


def save(on, url):
    url = (url or "").strip()
    if on:
        if not URL_RE.match(url):
            raise ValueError("That doesn't look like a proxy address. Example: socks5://127.0.0.1:9050")
        if url.startswith("socks") and not _socks_available():
            raise RuntimeError("SOCKS support isn't installed yet. Update Reddit Studio (it installs it automatically).")
    os.makedirs(os.path.dirname(CFG_FILE), exist_ok=True)
    fd = os.open(CFG_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"on": bool(on), "url": url}, f)
    apply_env()
    return status()


_PROXY_KEYS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "NO_PROXY", "no_proxy")
_ORIGINAL_ENV = {k: os.environ.get(k) for k in _PROXY_KEYS}


def apply_env():
    """Point libraries that read proxy environment variables (requests, httpx) at the proxy.
    With the proxy off, whatever proxy settings this Mac already had are left exactly as they were."""
    for k, v in _ORIGINAL_ENV.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    url = proxy_url()
    if url:
        env_url = url.replace("socks5://", "socks5h://")      # let the proxy resolve names (needed for Tor)
        for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
            os.environ[k] = env_url
        os.environ["NO_PROXY"] = os.environ["no_proxy"] = "127.0.0.1,localhost,::1"
    _opener.update(key=None, opener=None)


def opener(url=None):
    """A urllib opener for the given proxy (default: the saved one), or None for a direct connection."""
    url = url or proxy_url()
    if not url:
        return None
    if _opener["key"] == url:
        return _opener["opener"]
    if url.startswith("socks"):
        import socks
        from sockshandler import SocksiPyHandler
        m = re.match(r"^(socks5h?|socks4)://(?:([^:@]+)(?::([^@]*))?@)?([^:/]+):(\d+)", url)
        kind = socks.SOCKS4 if m.group(1) == "socks4" else socks.SOCKS5
        op = build_opener(SocksiPyHandler(kind, m.group(4), int(m.group(5)), rdns=True,
                                          username=m.group(2), password=m.group(3)))
    else:
        op = build_opener(ProxyHandler({"http": url, "https": url}))
    _opener.update(key=url, opener=op)
    return op


def urlopen(req, timeout=25, via=None):
    """Drop-in for urllib.request.urlopen that respects the proxy setting."""
    op = opener(via)
    if op is None:                       # proxy off: normal behavior, including macOS's own proxy settings
        from urllib.request import urlopen as default_urlopen
        return default_urlopen(req, timeout=timeout)
    return op.open(req, timeout=timeout)


def test(url=None):
    """Try Reddit through the proxy (the given address, or the saved setting) and report what happened."""
    started = time.time()
    if url:
        url = url.strip()
        if not URL_RE.match(url):
            raise ValueError("That doesn't look like a proxy address. Example: socks5://127.0.0.1:9050")
        if url.startswith("socks") and not _socks_available():
            raise RuntimeError("SOCKS support isn't installed yet. Update Reddit Studio (it installs it automatically).")
    via = url or proxy_url()
    req = Request("https://www.reddit.com/r/popular.json?limit=1&raw_json=1",
                  headers={"User-Agent": "macos:reddit-studio:network-test (personal, read-only)", "Accept": "application/json"})
    try:
        try:
            with urlopen(req, timeout=20, via=via) as r:
                code = r.status
        except Exception as e:
            code = getattr(e, "code", None)
            if code is None:
                raise
    except Exception as e:
        res = {"ok": False, "reached": False, "message": f"Couldn't connect{' through the proxy' if via else ''}: {e}"}
    else:
        msg = {200: "Reddit answered normally through this connection.",
               403: "Connected, but Reddit blocks this address (403). Try another server or exit point.",
               429: "Connected, but Reddit is rate-limiting this address (429)."}.get(code, f"Connected; Reddit answered HTTP {code}.")
        res = {"ok": code == 200, "reached": True, "status": code, "message": msg}
    res.update(ms=int((time.time() - started) * 1000), via=via or "direct (no proxy)")
    STATE["last_test"] = {**res, "at": time.time()}
    return res


def status():
    c = config()
    return {**c, "active": bool(proxy_url()), "socks_ready": _socks_available(), "presets": PRESETS,
            "last_test": STATE["last_test"]}


apply_env()
