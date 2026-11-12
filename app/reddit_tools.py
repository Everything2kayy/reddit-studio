"""Reddit Studio tools - keyless mode.

Reads Reddit's public .json pages, or its RSS feeds when .json is blocked
(no API keys, no login). Read-only.
Requests are spaced out and cached to stay well under Reddit's
unauthenticated rate limit (~10 requests/minute).
"""
import csv
import io
import json
import os
import re
import threading
import time
from collections import Counter
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, quote, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen

BASE = "https://www.reddit.com"
UA = "macos:reddit-studio:2.3 (personal, read-only)"
MIN_GAP = 2.5        # minimum seconds between live requests
CACHE_TTL = 180      # seconds to reuse a response
_rl = {"remaining": None, "reset_at": 0.0, "blocked_until": 0.0}

REGISTRY = {}
SORTS = ["hot", "new", "top", "rising", "controversial"]
TIMES = ["hour", "day", "week", "month", "year", "all"]
STOP = set("the a an and or of to in on for with is are was be this that it at by from as "
           "i you we my your our not but if so just do what how why when all about has have "
           "can will its it's im i'm get got any one out up new".split())
TRACKING_PARAMS = {"share_id", "ref", "ref_source", "context", "rdt", "utm_name"}

_lock = threading.Lock()
_last = [0.0]
_cache = {}


# ---------- fetching ----------
# Reddit blocked anonymous .json access in 2026. We still try it first (it has the
# most detail), and when Reddit blocks it we switch to Reddit's public RSS feeds,
# which carry posts, links, text, thumbnails and comments, but no scores.
MODE = {"rss": False, "since": 0.0}
JSON_RETRY = 1800    # re-check .json access every 30 minutes
NO_RSS = ("Reddit now blocks this information unless you have an approved API key, "
          "so this tool can't run in no-key mode.")


def _get(url, accept, headers=None):
    """One rate-limited HTTP GET. Returns (status, body_text)."""
    with _lock:
        now = time.time()
        if now < _rl["blocked_until"]:
            raise RuntimeError(f"Reddit asked us to slow down. Try again in "
                               f"{int(_rl['blocked_until'] - now) + 1} seconds.")
        wait = _last[0] + MIN_GAP - now
        if _rl["remaining"] is not None and _rl["remaining"] < 2 and _rl["reset_at"] > now:
            wait = max(wait, min(_rl["reset_at"] - now, 60))
        if wait > 0:
            time.sleep(wait)
        try:
            req = Request(url, headers={"User-Agent": UA, "Accept": accept, **(headers or {})})
            with urlopen(req, timeout=25) as r:
                try:
                    _rl["remaining"] = float(r.headers.get("x-ratelimit-remaining"))
                    _rl["reset_at"] = time.time() + float(r.headers.get("x-ratelimit-reset"))
                except (TypeError, ValueError):
                    _rl["remaining"] = None
                return r.status, r.read().decode("utf-8", "replace")
        except HTTPError as e:
            if e.code == 429:
                _rl["blocked_until"] = time.time() + 60
                raise RuntimeError("Reddit is rate-limiting you. Wait about a minute and try again.")
            try:
                body = e.read().decode("utf-8", "replace")
            except Exception:
                body = ""
            return e.code, body
        except URLError as e:
            raise RuntimeError(f"Couldn't reach Reddit: {e.reason}")
        finally:
            _last[0] = time.time()


# ---------- your own API key (optional, most reliable) ----------
# Create a free "script" app at reddit.com/prefs/apps and paste its client ID and secret
# into the account panel. Reddit Studio then reads through Reddit's official API
# (oauth.reddit.com) with an app-only token: read access only, never posts or votes.
API_FILE = os.path.expanduser("~/.config/reddit-studio/api_key.json")
API = {"token": None, "expires": 0.0, "error": None, "off": False}
OAUTH = "https://oauth.reddit.com"


def _api_cfg():
    try:
        with open(API_FILE) as f:
            c = json.load(f)
        if c.get("client_id") and c.get("client_secret"):
            return c
    except (OSError, ValueError):
        pass
    return None


def _api_token(force=False):
    import base64
    c = _api_cfg()
    if not c or API["off"]:
        return None
    if API["token"] and not force and time.time() < API["expires"] - 60:
        return API["token"]
    auth = base64.b64encode(f"{c['client_id']}:{c['client_secret']}".encode()).decode()
    req = Request("https://www.reddit.com/api/v1/access_token",
                  data=b"grant_type=client_credentials", method="POST",
                  headers={"User-Agent": _api_ua(c), "Authorization": "Basic " + auth,
                           "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urlopen(req, timeout=25) as r:
            d = json.loads(r.read().decode("utf-8", "replace"))
    except HTTPError as e:
        API.update(token=None, error=("Reddit rejected your API key. Check the client ID and secret, "
                                      "and that the app type is \"script\"." if e.code in (400, 401)
                                      else f"Reddit's sign-in server returned HTTP {e.code}."))
        return None
    except (URLError, OSError, ValueError) as e:
        API.update(token=None, error=f"Couldn't reach Reddit to use your API key ({e}).")
        return None
    if not d.get("access_token"):
        API.update(token=None, error="Reddit rejected your API key: " + str(d.get("error") or "no token"))
        return None
    API.update(token=d["access_token"], expires=time.time() + float(d.get("expires_in") or 3600), error=None)
    return API["token"]


def _api_ua(c=None):
    c = c or _api_cfg() or {}
    who = re.sub(r"^/?u/", "", (c.get("username") or "").strip())
    return f"macos:reddit-studio:{_version()} (by /u/{who})" if who else UA


def _version():
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "VERSION")) as f:
            return f.read().strip()
    except OSError:
        return "2"


def api_set(client_id, client_secret, username=""):
    client_id, client_secret = (client_id or "").strip(), (client_secret or "").strip()
    if not client_id or not client_secret:
        raise ValueError("Paste both the client ID and the secret.")
    os.makedirs(os.path.dirname(API_FILE), exist_ok=True)
    fd = os.open(API_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"client_id": client_id, "client_secret": client_secret,
                   "username": re.sub(r"^/?u/", "", (username or "").strip())}, f)
    API.update(token=None, expires=0.0, error=None, off=False)
    _cache.clear()
    if not _api_token(force=True):
        raise ValueError(API["error"] or "Reddit didn't accept that key.")
    return api_status()


def api_clear():
    try:
        os.remove(API_FILE)
    except OSError:
        pass
    API.update(token=None, expires=0.0, error=None)
    _cache.clear()
    return api_status()


def api_status():
    c = _api_cfg()
    return {"configured": bool(c), "client_id": (c["client_id"][:4] + "…") if c else "",
            "username": (c or {}).get("username", ""), "active": bool(c) and not API["off"] and not API["error"],
            "error": API["error"]}


def _fetch_api(path, params):
    key = "api:" + path + "?" + urlencode(sorted(params.items()))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    for attempt in (0, 1):
        tok = _api_token(force=bool(attempt))
        if not tok:
            return None
        url = f"{OAUTH}{'' if path == '/' else path}?{urlencode({**params, 'raw_json': 1})}"
        code, body = _get(url, "application/json", {"Authorization": "bearer " + tok, "User-Agent": _api_ua()})
        if code == 401 and not attempt:
            continue                     # token expired early: get a new one once
        break
    if code == 200:
        try:
            data = json.loads(body)
        except ValueError:
            raise RuntimeError("Reddit sent back a page instead of data.")
        API["error"] = None
        _cache[key] = (time.time(), data)
        return data
    if code == 404:
        raise RuntimeError("Reddit says that doesn't exist (404). Check the spelling.")
    if code == 403:
        try:
            reason = json.loads(body).get("reason")
        except (ValueError, AttributeError):
            reason = None
        raise RuntimeError(f"Reddit says that community is {reason}." if reason
                           else "Reddit returned 403: it's private, banned, or your key can't see it.")
    API["error"] = f"API request failed (HTTP {code}); trying other sources."
    return None


# ---------- signed-in mode (optional, via rdt-cli) ----------
# If you've installed rdt-cli and run `rdt login`, Reddit Studio reuses that saved
# sign-in for full data (scores, nested comments, your home feed, saved posts).
# It only reads; it never posts, votes, or messages. Remove the sign-in with `rdt logout`.
CRED_FILE = os.path.expanduser("~/.config/rdt-cli/credential.json")
SIGNED = {"client": None, "mtime": None, "user": None, "error": None, "off": False}


def _signed_client():
    if SIGNED["off"] or not os.path.exists(CRED_FILE):
        return None
    try:
        from rdt_cli.auth import Credential
        from rdt_cli.client import RedditClient
    except ImportError:
        return None
    mtime = os.path.getmtime(CRED_FILE)
    if SIGNED["client"] is None or SIGNED["mtime"] != mtime:
        try:
            with open(CRED_FILE) as f:
                cred = Credential.from_dict(json.load(f))
        except (OSError, ValueError):
            return None
        if not cred.is_valid:
            return None
        if SIGNED["client"] is not None:
            try:
                SIGNED["client"].__exit__(None, None, None)
            except Exception:
                pass
        client = RedditClient(credential=cred, request_delay=1.0)
        client.__enter__()
        SIGNED.update(client=client, mtime=mtime, user=cred.username, error=None)
    return SIGNED["client"]


def signed_status():
    return {"available": bool(_signed_client()), "user": SIGNED["user"], "error": SIGNED["error"],
            "off": SIGNED["off"], "rss": MODE["rss"], "cred_file": os.path.exists(CRED_FILE),
            "api": api_status()}


def _fetch_signed(client, path, params):
    key = "signed:" + path + "?" + urlencode(sorted(params.items()))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    url = "/.json" if path == "/" else path + ".json"
    with _lock:
        data = client._get(url, params={**params, "raw_json": 1})
    SIGNED["error"] = None
    _cache[key] = (time.time(), data)
    return data


def fetch(path, **params):
    params = {k: v for k, v in params.items() if v not in (None, "")}
    if path != "/" and not re.fullmatch(r"/user/[^/]+/(saved|upvoted)", path) and _api_cfg() and not API["off"]:
        data = _fetch_api(path, params)
        if data is not None:
            return data
    client = _signed_client()
    if client is not None:
        try:
            return _fetch_signed(client, path, params)
        except Exception as e:          # map rdt-cli's errors to plain language
            kind = type(e).__name__
            if kind == "NotFoundError":
                raise RuntimeError("Reddit says that doesn't exist (404). Check the spelling.")
            if kind == "RateLimitError":
                raise RuntimeError("Reddit is rate-limiting you. Wait about a minute and try again.")
            if kind == "ForbiddenError":
                # Reddit often answers 403 to a stale or flagged sign-in even for public pages,
                # so try public data before blaming the community.
                SIGNED["error"] = ("Reddit refused your signed-in request (403). If this keeps happening, "
                                   "run `rdt login` in Terminal to refresh your sign-in.")
            elif kind in ("SessionExpiredError", "AuthRequiredError") or "HTML instead of JSON" in str(e):
                SIGNED["error"] = "Your Reddit sign-in expired. Run `rdt login` in Terminal to refresh it."
            else:
                SIGNED["error"] = f"Signed-in request failed ({kind}); using public data instead."
            # fall through to public data / RSS
    if path in ("/",) or re.fullmatch(r"/user/[^/]+/(saved|upvoted)", path):
        raise RuntimeError(SIGNED["error"] or "Sign in first: this needs your Reddit account (see the account button, top right).")
    if MODE["rss"] and time.time() - MODE["since"] > JSON_RETRY:
        MODE["rss"] = False
    if not MODE["rss"]:
        url = f"{BASE}{path}.json?{urlencode({**params, 'raw_json': 1})}"
        hit = _cache.get(url)
        if hit and time.time() - hit[0] < CACHE_TTL:
            return hit[1]
        code, body = _get(url, "application/json")
        if code == 200:
            try:
                data = json.loads(body)
            except ValueError:
                raise RuntimeError("Reddit sent back a page instead of data. "
                                   "The name is probably wrong or doesn't exist.")
            _cache[url] = (time.time(), data)
            return data
        if code == 404:
            raise RuntimeError("Reddit says that doesn't exist (404). Check the spelling.")
        if code != 403:
            raise RuntimeError(f"Reddit returned HTTP {code}.")
        try:
            reason = json.loads(body).get("reason")
        except (ValueError, AttributeError):
            reason = None
        if reason:      # a real per-community answer, e.g. private or banned
            raise RuntimeError(f"Reddit says that community is {reason}.")
        MODE.update(rss=True, since=time.time())     # blanket block: switch to RSS
    return _fetch_rss(path, params)


# ---------- RSS fallback ----------
_A = "{http://www.w3.org/2005/Atom}"
_M = "{http://search.yahoo.com/mrss/}"


def _rss_url(path, params):
    if re.search(r"/about(/rules)?$", path) or path.startswith("/subreddits"):
        raise RuntimeError(NO_RSS)
    m = re.fullmatch(r"/user/([^/]+)/overview", path)
    if m:
        path = f"/user/{m.group(1)}"
    tail = ".rss" if path.endswith("/search") else "/.rss"
    q = urlencode(params)
    return f"{BASE}{path}{tail}" + (f"?{q}" if q else "")


def _iso(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0


def _strip_tags(h):
    import html as _h
    return _h.unescape(re.sub(r"<[^>]+>", " ", h or "")).strip()


def _rss_entry(e):
    import html as _h
    eid = e.findtext(_A + "id") or ""
    le = e.find(_A + "link")
    link = le.get("href", "") if le is not None else ""
    permalink = urlparse(link).path
    author = (e.findtext(f"{_A}author/{_A}name") or "").strip().removeprefix("/u/") or "[deleted]"
    cat = e.find(_A + "category")
    sub = cat.get("term", "") if cat is not None else ""
    if not sub:
        m = re.search(r"/r/([^/]+)/", link)
        sub = m.group(1) if m else ""
    content = e.findtext(_A + "content") or ""
    created = _iso(e.findtext(_A + "published") or e.findtext(_A + "updated"))
    sm = re.search(r"<!-- SC_OFF -->(.*?)<!-- SC_ON -->", content, re.S)
    if eid.startswith("t1_"):
        body = sm.group(1).strip() if sm else content
        return "t1", {"id": eid[3:], "name": eid, "author": author, "subreddit": sub,
                      "created_utc": created, "body_html": body, "body": _strip_tags(body),
                      "permalink": permalink}
    m = re.search(r'<a href="([^"]+)">\s*\[link\]\s*</a>', content)
    url = _h.unescape(m.group(1)) if m else link
    selftext_html = sm.group(1).strip() if sm else ""
    th = e.find(_M + "thumbnail")
    thumb = th.get("url", "") if th is not None else ""
    if not thumb:
        im = re.search(r'<img src="([^"]+)"', content)
        thumb = _h.unescape(im.group(1)) if im else ""
    pu = urlparse(url)
    is_self = pu.netloc.endswith("reddit.com") and pu.path.rstrip("/") == permalink.rstrip("/")
    domain = f"self.{sub}" if is_self else pu.netloc.removeprefix("www.")
    d = {"id": eid[3:], "name": eid, "title": _h.unescape(e.findtext(_A + "title") or ""),
         "author": author, "subreddit": sub, "created_utc": created, "permalink": permalink,
         "url": url, "domain": domain, "is_self": is_self, "selftext_html": selftext_html,
         "selftext": _strip_tags(selftext_html), "thumbnail": thumb or "self"}
    big = url if re.search(r"\.(jpe?g|png|gif|webp)(\?|$)", url, re.I) else thumb
    if big:
        d["preview"] = {"images": [{"source": {"url": big},
                                    "resolutions": [{"url": thumb or big, "width": 320}]}]}
    if pu.netloc == "v.redd.it":
        hls = url.rstrip("/") + "/HLSPlaylist.m3u8"
        d.update(is_video=True, secure_media={"reddit_video": {"fallback_url": hls, "hls_url": hls}})
    if "/gallery/" in url:
        d["is_gallery"] = True
    return "t3", d


def _listing_of(items, after):
    return {"kind": "Listing", "data": {"children": [{"kind": k, "data": d} for k, d in items],
                                        "after": after}}


def _fetch_rss(path, params):
    import xml.etree.ElementTree as ET
    params = {k: v for k, v in params.items() if k != "raw_json"}
    url = _rss_url(path, params)
    hit = _cache.get(url)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    code, body = _get(url, "application/atom+xml, application/rss+xml, application/xml")
    if code == 404:
        raise RuntimeError("Reddit says that doesn't exist (404). Check the spelling.")
    if code == 403:
        raise RuntimeError("Reddit is blocking both its data and RSS feeds for your connection right now. "
                           "Try again later, or from a different network (for example, your phone's hotspot).")
    if code != 200:
        raise RuntimeError(f"Reddit returned HTTP {code}.")
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        raise RuntimeError("Reddit sent back a page instead of a feed. The name is probably wrong.")
    items = [_rss_entry(e) for e in root.findall(_A + "entry")]
    if path.startswith("/comments/"):
        posts = [x for x in items if x[0] == "t3"][:1]
        cmts = [x for x in items if x[0] == "t1"]
        data = [_listing_of(posts, None), _listing_of(cmts, None)]
    else:
        limit = int(params.get("limit", 25) or 25)
        last = next((d["name"] for k, d in reversed(items) if k == "t3"), None)
        data = _listing_of(items, last if len(items) >= min(limit, 25) else None)
    _cache[url] = (time.time(), data)
    return data


def children(data, kind=None):
    if isinstance(data, list):
        data = data[0]
    out = []
    for c in (data or {}).get("data", {}).get("children", []):
        if kind is None or c.get("kind") == kind:
            out.append(c["data"])
    return out


# ---------- registry ----------
def P(key, label, type="text", default="", options=None):
    d = {"key": key, "label": label, "type": type, "default": default}
    if options:
        d["options"] = options
    return d


def tool(id, name, category, description, params=()):
    def wrap(fn):
        REGISTRY[id] = {"id": id, "name": name, "category": category,
                        "description": description, "params": list(params), "fn": fn}
        return fn
    return wrap


# ---------- helpers ----------
def _int(p, key, default, lo=1, hi=100):
    try:
        v = int(p.get(key, default))
    except (TypeError, ValueError):
        v = default
    return max(lo, min(hi, v))


def _clean(s, prefix):
    s = str(s or "").strip().strip("/")
    for pre in (prefix + "/", "/" + prefix + "/"):
        if s.lower().startswith(pre):
            s = s[len(pre):]
    if not re.fullmatch(r"[A-Za-z0-9_\-+]+", s or ""):
        raise ValueError(f"Enter a valid {'subreddit' if prefix == 'r' else 'username'}.")
    return s


def _sub(p, key="sub"):
    return _clean(p.get(key), "r")


def _name(p):
    return _clean(p.get("name"), "u")


def _ts(epoch):
    return datetime.fromtimestamp(float(epoch), timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _avg(xs):
    return round(sum(xs) / len(xs), 1) if xs else 0


def _sort(p, allowed=SORTS, default="hot"):
    s = p.get("sort", default)
    return s if s in allowed else default


def _time(p):
    t = p.get("time", "week")
    return t if t in TIMES else "week"


def post_row(d):
    return {"title": d.get("title", ""), "score": d.get("score"),
            "upvote_ratio": d.get("upvote_ratio"), "comments": d.get("num_comments"),
            "subreddit": d.get("subreddit", ""), "author": d.get("author", ""),
            "flair": d.get("link_flair_text") or "", "posted": _ts(d.get("created_utc", 0)),
            "domain": d.get("domain", ""), "url": BASE + d.get("permalink", "")}


def comment_row(c, depth=0):
    return {"author": c.get("author", ""), "score": c.get("score"), "depth": depth,
            "body": (c.get("body") or "")[:500]}


def _listing(p, default_limit=50):
    sort = _sort(p)
    params = {"limit": _int(p, "limit", default_limit)}
    if sort in ("top", "controversial"):
        params["t"] = _time(p)
    return children(fetch(f"/r/{_sub(p)}/{sort}", **params), "t3")


def _post_id(ref):
    ref = str(ref or "").strip()
    m = re.search(r"comments/([a-z0-9]+)", ref, re.I) or re.search(r"redd\.it/([a-z0-9]+)", ref, re.I)
    if m:
        return m.group(1)
    ref = ref.removeprefix("t3_")
    if re.fullmatch(r"[a-z0-9]{4,10}", ref, re.I):
        return ref
    raise ValueError("Paste a Reddit post link or post ID.")


def _thread(p, limit=200, sort="top"):
    data = fetch(f"/comments/{_post_id(p.get('ref'))}", sort=sort, limit=limit)
    post = children(data[0], "t3")[0]
    return post, data[1]["data"]["children"]


def walk(nodes, depth=0):
    for n in nodes:
        if n.get("kind") != "t1":
            continue
        c = n["data"]
        yield c, depth
        rep = c.get("replies")
        if isinstance(rep, dict):
            yield from walk(rep["data"]["children"], depth + 1)


def media_links(d):
    out = []
    v = ((d.get("secure_media") or d.get("media") or {}) or {}).get("reddit_video")
    if v and v.get("fallback_url"):
        out.append({"type": "video (no audio)", "url": v["fallback_url"].split("?")[0]})
        if v.get("hls_url"):
            out.append({"type": "video stream (with audio, HLS)", "url": v["hls_url"]})
    meta = d.get("media_metadata") or {}
    items = (d.get("gallery_data") or {}).get("items") or [{"media_id": k} for k in meta]
    for it in items:
        s = (meta.get(it.get("media_id")) or {}).get("s") or {}
        u = s.get("u") or s.get("gif") or s.get("mp4")
        if u:
            out.append({"type": "gallery image", "url": u})
    u = d.get("url_overridden_by_dest") or d.get("url") or ""
    if re.search(r"\.(jpe?g|png|gif|webp|mp4|gifv)(\?|$)", u, re.I):
        out.append({"type": "video" if re.search(r"mp4|gifv", u, re.I) else "image", "url": u})
    elif "i.redd.it" in u or "i.imgur.com" in u:
        out.append({"type": "image", "url": u})
    seen, uniq = set(), []
    for m in out:
        if m["url"] not in seen:
            seen.add(m["url"])
            uniq.append(m)
    return uniq


LIST_PARAMS = [
    P("sub", "Subreddit", default="python"),
    P("sort", "Sort", "select", "hot", SORTS),
    P("time", "Time range (top/controversial)", "select", "week", TIMES),
    P("limit", "Count (max 100)", "int", 50),
]
SUB = [P("sub", "Subreddit", default="python")]
REF = [P("ref", "Post link or ID")]

# =================================================================
# Browse
# =================================================================
@tool("sub_info", "Subreddit info", "Browse", "Members, age, and description.", SUB)
def sub_info(p):
    d = fetch(f"/r/{_sub(p)}/about")["data"]
    return {"name": d.get("display_name_prefixed"), "title": d.get("title"),
            "members": d.get("subscribers"), "online_now": d.get("active_user_count"),
            "created": _ts(d.get("created_utc", 0)), "nsfw": d.get("over18"),
            "type": d.get("subreddit_type"), "description": d.get("public_description")}


@tool("sub_posts", "Subreddit posts", "Browse", "Posts in any sort order.", LIST_PARAMS)
def sub_posts(p):
    return [post_row(d) for d in _listing(p, 25)]


@tool("search", "Search posts", "Browse", "Search all of Reddit or one subreddit.",
      [P("query", "Search terms"), P("sub", "Only this subreddit (optional)"),
       P("sort", "Sort", "select", "relevance", ["relevance", "new", "top", "comments", "hot"]),
       P("time", "Time range", "select", "year", TIMES), P("limit", "Count", "int", 25)])
def search(p):
    q = str(p.get("query", "")).strip()
    if not q:
        raise ValueError("Enter search terms.")
    sub = str(p.get("sub", "")).strip()
    path = f"/r/{_sub(p)}/search" if sub else "/search"
    data = fetch(path, q=q, sort=_sort(p, ["relevance", "new", "top", "comments", "hot"], "relevance"),
                 t=_time(p), limit=_int(p, "limit", 25), restrict_sr=1 if sub else None)
    return [post_row(d) for d in children(data, "t3")]


@tool("sub_search", "Find subreddits", "Browse", "Search for communities by topic.",
      [P("query", "Topic"), P("limit", "Count", "int", 25)])
def sub_search(p):
    q = str(p.get("query", "")).strip()
    if not q:
        raise ValueError("Enter a topic.")
    return [{"subreddit": d.get("display_name_prefixed"), "members": d.get("subscribers"),
             "nsfw": d.get("over18"), "description": (d.get("public_description") or "")[:160]}
            for d in children(fetch("/subreddits/search", q=q, limit=_int(p, "limit", 25)))]


@tool("popular", "Popular subreddits", "Browse", "Communities on Reddit's popular list.",
      [P("limit", "Count", "int", 25)])
def popular(p):
    return [{"subreddit": d.get("display_name_prefixed"), "members": d.get("subscribers"),
             "description": (d.get("public_description") or "")[:160]}
            for d in children(fetch("/subreddits/popular", limit=_int(p, "limit", 25)))]


@tool("new_subs", "Newest subreddits", "Browse", "Recently created communities.",
      [P("limit", "Count", "int", 25)])
def new_subs(p):
    return [{"subreddit": d.get("display_name_prefixed"), "members": d.get("subscribers"),
             "created": _ts(d.get("created_utc", 0)),
             "description": (d.get("public_description") or "")[:160]}
            for d in children(fetch("/subreddits/new", limit=_int(p, "limit", 25)))]


@tool("rules", "Subreddit rules", "Browse", "A community's posted rules.", SUB)
def rules(p):
    return [{"rule": r.get("short_name"), "details": (r.get("description") or "")[:400]}
            for r in fetch(f"/r/{_sub(p)}/about/rules").get("rules", [])]


@tool("front", "Front page / r/all", "Browse", "What's on r/popular or r/all right now.",
      [P("feed", "Feed", "select", "popular", ["popular", "all"]),
       P("sort", "Sort", "select", "hot", SORTS), P("time", "Time range", "select", "day", TIMES),
       P("limit", "Count", "int", 25)])
def front(p):
    feed = "all" if p.get("feed") == "all" else "popular"
    return sub_posts({**p, "sub": feed})

# =================================================================
# Threads
# =================================================================
@tool("post", "Post + top comments", "Threads", "A post's text and its best comments.",
      REF + [P("comments", "Top comments to show", "int", 15)])
def post(p):
    d, nodes = _thread(p, limit=100)
    out = post_row(d)
    out["body"] = (d.get("selftext") or "")[:4000]
    out["top_comments"] = [comment_row(c) for c, _ in
                           [x for x in walk(nodes) if x[1] == 0][:_int(p, "comments", 15, 1, 100)]]
    return out


@tool("thread_md", "Thread to Markdown", "Threads", "Save a whole discussion as Markdown.",
      REF + [P("max_comments", "Max comments", "int", 300, )])
def thread_md(p):
    d, nodes = _thread(p, limit=500)
    out = [f"# {d.get('title')}", f"*r/{d.get('subreddit')} · u/{d.get('author')} · "
           f"{d.get('score')} points · {_ts(d.get('created_utc', 0))}*", "",
           (d.get("selftext") or "").strip(), "", "## Comments", ""]
    for i, (c, depth) in enumerate(walk(nodes)):
        if i >= _int(p, "max_comments", 300, 1, 2000):
            break
        out.append(f"{'  ' * depth}- **u/{c.get('author')}** ({c.get('score')}): "
                   f"{(c.get('body') or '').replace(chr(10), ' ')}")
    return "\n".join(out)


@tool("thread_search", "Search inside a thread", "Threads", "Find comments containing a word.",
      REF + [P("query", "Word or phrase")])
def thread_search(p):
    q = str(p.get("query", "")).strip().lower()
    if not q:
        raise ValueError("Enter a word or phrase.")
    _, nodes = _thread(p, limit=500)
    return [comment_row(c, depth) for c, depth in walk(nodes) if q in (c.get("body") or "").lower()]


@tool("thread_stats", "Thread stats", "Threads", "Top commenters, depth, and score spread.", REF)
def thread_stats(p):
    d, nodes = _thread(p, limit=500)
    cs = list(walk(nodes))
    who = Counter(c.get("author") for c, _ in cs if c.get("author") not in (None, "[deleted]"))
    return {"title": d.get("title"), "loaded_comments": len(cs),
            "reported_comments": d.get("num_comments"),
            "deepest_reply": max((dep for _, dep in cs), default=0),
            "avg_comment_score": _avg([c.get("score", 0) for c, _ in cs]),
            "op_replies": sum(1 for c, _ in cs if c.get("author") == d.get("author")),
            "top_commenters": [{"user": k, "comments": v} for k, v in who.most_common(10)]}


@tool("post_media", "Post media links", "Threads",
      "Direct image, gallery, and video links from a post.", REF)
def post_media(p):
    d, _ = _thread(p, limit=1)
    links = media_links(d)
    if not links:
        raise ValueError("No downloadable media found in that post.")
    return links

# =================================================================
# People
# =================================================================
@tool("user", "User profile", "People", "Karma, account age, and favorite subreddits.",
      [P("name", "Username")])
def user(p):
    n = _name(p)
    try:
        a = fetch(f"/user/{n}/about")["data"]
    except RuntimeError as e:
        if str(e) != NO_RSS:
            raise
        a = {"name": n}       # limited mode: karma and account age aren't available
    if a.get("is_suspended"):
        return {"username": n, "status": "suspended"}
    cs = children(fetch(f"/user/{n}/comments", limit=100), "t1")
    subs = Counter(c.get("subreddit") for c in cs)
    info = {"username": a.get("name")}
    if a.get("created_utc"):
        info.update(post_karma=a.get("link_karma"), comment_karma=a.get("comment_karma"),
                    created=_ts(a["created_utc"]))
    else:
        info["note"] = "Karma and account age aren't available in limited mode."
    return {**info,
            "top_subreddits_recent_comments": [{"subreddit": k, "comments": v}
                                               for k, v in subs.most_common(10)]}


@tool("user_items", "User posts or comments", "People", "Recent posts or comments by a user.",
      [P("name", "Username"), P("kind", "Type", "select", "posts", ["posts", "comments"]),
       P("sort", "Sort", "select", "new", ["new", "top", "hot", "controversial"]),
       P("limit", "Count", "int", 25)])
def user_items(p):
    n = _name(p)
    sort = _sort(p, ["new", "top", "hot", "controversial"], "new")
    if p.get("kind") == "comments":
        return [{**comment_row(c), "subreddit": c.get("subreddit"),
                 "posted": _ts(c.get("created_utc", 0)), "url": BASE + c.get("permalink", "")}
                for c in children(fetch(f"/user/{n}/comments", sort=sort,
                                        limit=_int(p, "limit", 25)), "t1")]
    return [post_row(d) for d in children(fetch(f"/user/{n}/submitted", sort=sort,
                                                limit=_int(p, "limit", 25)), "t3")]


@tool("user_hours", "User activity hours", "People",
      "When a user is usually active, by hour (UTC) and weekday.", [P("name", "Username")])
def user_hours(p):
    items = children(fetch(f"/user/{_name(p)}/overview", limit=100))
    hours, days = Counter(), Counter()
    for it in items:
        dt = datetime.fromtimestamp(it.get("created_utc", 0), timezone.utc)
        hours[dt.hour] += 1
        days[dt.strftime("%a")] += 1
    order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    return {"sampled_items": len(items),
            "by_hour_utc": [{"hour": h, "items": hours.get(h, 0)} for h in range(24)],
            "by_weekday": [{"day": d, "items": days.get(d, 0)} for d in order]}

# =================================================================
# Analyze
# =================================================================
@tool("words", "Word frequency", "Analyze", "Most common words in post titles.", LIST_PARAMS)
def words(p):
    c = Counter()
    for d in _listing(p):
        for w in re.findall(r"[a-z][a-z']{2,}", d.get("title", "").lower()):
            if w not in STOP:
                c[w] += 1
    return [{"word": w, "count": n} for w, n in c.most_common(40)]


@tool("domains", "Top linked sites", "Analyze", "Which websites a subreddit links to most.",
      LIST_PARAMS)
def domains(p):
    c = Counter(d.get("domain") for d in _listing(p))
    return [{"domain": k, "posts": v} for k, v in c.most_common(25)]


@tool("times", "Best posting hours", "Analyze",
      "Average score by hour (UTC) in a sample. A rough guide, not a guarantee.", LIST_PARAMS)
def times(p):
    b = {}
    for d in _listing(p, 100):
        h = datetime.fromtimestamp(d.get("created_utc", 0), timezone.utc).hour
        n, t = b.get(h, (0, 0))
        b[h] = (n + 1, t + d.get("score", 0))
    return [{"hour_utc": h, "posts": n, "avg_score": round(t / n, 1)} for h, (n, t) in sorted(b.items())]


@tool("compare", "Compare subreddits", "Analyze",
      "Size and engagement side by side (up to 5; takes a few seconds each).",
      [P("subs", "Subreddits, comma-separated", default="python,learnpython")])
def compare(p):
    names = [x.strip() for x in str(p.get("subs", "")).split(",") if x.strip()][:5]
    rows = []
    for n in names:
        s = _clean(n, "r")
        about = fetch(f"/r/{s}/about")["data"]
        posts = children(fetch(f"/r/{s}/hot", limit=50), "t3")
        rows.append({"subreddit": s, "members": about.get("subscribers"),
                     "online_now": about.get("active_user_count"),
                     "avg_score_hot50": _avg([x.get("score", 0) for x in posts]),
                     "avg_comments_hot50": _avg([x.get("num_comments", 0) for x in posts])})
    return rows


@tool("flair_stats", "Flair breakdown", "Analyze", "Which post flairs appear most.", LIST_PARAMS)
def flair_stats(p):
    c = Counter(d.get("link_flair_text") or "(none)" for d in _listing(p, 100))
    return [{"flair": k, "posts": v} for k, v in c.most_common(30)]


@tool("controversial_posts", "Most argued-over posts", "Analyze",
      "Posts with many comments compared with their score.", LIST_PARAMS)
def controversial_posts(p):
    rows = []
    for d in _listing(p, 100):
        r = post_row(d)
        r["comments_per_point"] = round(d.get("num_comments", 0) / max(d.get("score", 0), 1), 2)
        rows.append(r)
    return sorted(rows, key=lambda x: x["comments_per_point"], reverse=True)[:25]


@tool("dupes", "Repost finder", "Analyze", "Posts with near-identical titles.", LIST_PARAMS)
def dupes(p):
    g = {}
    for d in _listing(p, 100):
        key = re.sub(r"[^a-z0-9]+", " ", d.get("title", "").lower()).strip()
        g.setdefault(key, []).append(BASE + d.get("permalink", ""))
    return [{"title": k, "count": len(v), "links": v} for k, v in g.items() if len(v) > 1]


@tool("post_ages", "Post age spread", "Analyze", "How old the posts in a listing are.", LIST_PARAMS)
def post_ages(p):
    now = time.time()
    ages = sorted((now - d.get("created_utc", now)) / 3600 for d in _listing(p, 100))
    if not ages:
        return {"posts": 0}
    return {"posts": len(ages), "newest_hours": round(ages[0], 1),
            "median_hours": round(ages[len(ages) // 2], 1), "oldest_hours": round(ages[-1], 1)}


@tool("keyword_watch", "Keyword watch", "Analyze", "Count keyword hits in the newest posts.",
      SUB + [P("keywords", "Keywords, comma-separated", default="async,typing"),
             P("limit", "Posts to scan", "int", 100)])
def keyword_watch(p):
    kws = [k.strip().lower() for k in str(p.get("keywords", "")).split(",") if k.strip()]
    if not kws:
        raise ValueError("Enter at least one keyword.")
    hits = {k: [] for k in kws}
    for d in children(fetch(f"/r/{_sub(p)}/new", limit=_int(p, "limit", 100)), "t3"):
        text = (d.get("title", "") + " " + (d.get("selftext") or "")).lower()
        for k in kws:
            if k in text:
                hits[k].append(BASE + d.get("permalink", ""))
    return [{"keyword": k, "matches": len(v), "links": v[:10]} for k, v in hits.items()]


@tool("top_posters", "Most active posters", "Analyze", "Who posts most in a listing.", LIST_PARAMS)
def top_posters(p):
    posts = _listing(p, 100)
    c = Counter(d.get("author") for d in posts if d.get("author") != "[deleted]")
    score = Counter()
    for d in posts:
        score[d.get("author")] += d.get("score", 0)
    return [{"user": u, "posts": n, "total_score": score[u]} for u, n in c.most_common(25)]


@tool("post_types", "Post type mix", "Analyze", "Share of text, image, video, and link posts.",
      LIST_PARAMS)
def post_types(p):
    c, scores = Counter(), {}
    for d in _listing(p, 100):
        if d.get("is_self"):
            k = "text"
        elif d.get("is_video"):
            k = "video"
        elif d.get("is_gallery") or d.get("post_hint") == "image":
            k = "image/gallery"
        else:
            k = "link"
        c[k] += 1
        scores.setdefault(k, []).append(d.get("score", 0))
    return [{"type": k, "posts": n, "avg_score": _avg(scores[k])} for k, n in c.most_common()]


@tool("sub_media", "Subreddit media links", "Analyze",
      "Direct image and video links from a subreddit's posts.", LIST_PARAMS)
def sub_media(p):
    rows = []
    for d in _listing(p, 50):
        for m in media_links(d):
            rows.append({"title": d.get("title", "")[:80], **m, "post": BASE + d.get("permalink", "")})
    return rows

# =================================================================
# Export
# =================================================================
@tool("csv", "Export posts to CSV", "Export", "Download posts as a spreadsheet file.", LIST_PARAMS)
def export_csv(p):
    rows = [post_row(d) for d in _listing(p, 100)]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()) if rows else ["title"])
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


@tool("json_export", "Export posts to JSON", "Export", "Download posts as JSON.", LIST_PARAMS)
def json_export(p):
    return [post_row(d) for d in _listing(p, 100)]


@tool("digest", "Markdown digest", "Export", "A readable summary of top posts.", LIST_PARAMS)
def digest(p):
    posts = _listing({**p, "sort": p.get("sort") or "top"}, 25)
    lines = [f"# r/{_sub(p)} digest", f"*{datetime.now(timezone.utc):%Y-%m-%d %H:%M UTC}*", ""]
    for i, d in enumerate(posts, 1):
        stats = (f"- {d.get('score')} pts, {d.get('num_comments')} comments, u/{d.get('author')}"
                 if d.get("score") is not None else f"- u/{d.get('author')}")
        lines.append(f"{i}. **[{d.get('title')}]({BASE}{d.get('permalink')})** {stats}")
        body = (d.get("selftext") or "").strip().replace("\n", " ")
        if body:
            lines.append(f"   > {body[:240]}{'…' if len(body) > 240 else ''}")
    return "\n".join(lines)

# =================================================================
# Utilities (no Reddit request)
# =================================================================
@tool("url_clean", "Clean URL", "Utilities", "Strip tracking junk from any link.", [P("url", "URL")])
def url_clean(p):
    u = urlparse(str(p.get("url", "")).strip())
    if not u.scheme:
        raise ValueError("Enter a full URL including https://")
    keep = [(k, v) for k, v in parse_qsl(u.query, keep_blank_values=True)
            if k not in TRACKING_PARAMS and not k.startswith("utm_")]
    return urlunparse(u._replace(query=urlencode(keep)))


@tool("reddit_convert", "Convert Reddit link", "Utilities",
      "Switch a Reddit link between www, old, and mobile.",
      [P("url", "Reddit URL"), P("to", "Convert to", "select", "www", ["www", "old", "mobile"])])
def reddit_convert(p):
    u = urlparse(str(p.get("url", "")).strip())
    if not re.fullmatch(r"([a-z]+\.)?reddit\.com", u.netloc or ""):
        raise ValueError("Paste a reddit.com link.")
    host = {"www": "www.reddit.com", "old": "old.reddit.com", "mobile": "m.reddit.com"}[
        p.get("to") if p.get("to") in ("www", "old", "mobile") else "www"]
    return urlunparse(u._replace(netloc=host, query=""))


@tool("timestamp", "Timestamp converter", "Utilities",
      "Epoch seconds ↔ readable UTC date.", [P("value", "Epoch number, or YYYY-MM-DD HH:MM")])
def timestamp(p):
    v = str(p.get("value", "")).strip()
    if v.lstrip("-").replace(".", "", 1).isdigit():
        return {"utc": _ts(v), "iso": datetime.fromtimestamp(float(v), timezone.utc).isoformat()}
    try:
        dt = datetime.strptime(v, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    except ValueError:
        raise ValueError("Use an epoch number or the format YYYY-MM-DD HH:MM")
    return {"epoch": int(dt.timestamp())}


@tool("md_format", "Markdown helper", "Utilities",
      "Quote, code-block, spoiler, or escape text for a comment.",
      [P("text", "Text"), P("mode", "Mode", "select", "quote", ["quote", "code", "spoiler", "escape"])])
def md_format(p):
    t = str(p.get("text", ""))
    mode = p.get("mode", "quote")
    if mode == "quote":
        return "\n".join("> " + line for line in t.splitlines())
    if mode == "code":
        return "    " + t.replace("\n", "\n    ")
    if mode == "spoiler":
        return f">!{t}!<"
    return re.sub(r"([\\`*_\[\]()#+\-.!>|~])", r"\\\1", t)


@tool("word_count", "Word counter", "Utilities", "Words, characters, and reading time.",
      [P("text", "Text")])
def word_count(p):
    t = str(p.get("text", ""))
    w = len(re.findall(r"\S+", t))
    return {"words": w, "characters": len(t), "lines": len(t.splitlines()),
            "reading_time_min": round(w / 230, 1)}


@tool("raw_json", "Raw JSON viewer", "Utilities",
      "See the raw data Reddit returns for any reddit.com path.",
      [P("path", "Path, e.g. /r/python/about", default="/r/python/about")])
def raw_json(p):
    path = str(p.get("path", "")).strip()
    path = re.sub(r"^https?://[a-z.]*reddit\.com", "", path).split("?")[0].removesuffix(".json")
    if not path.startswith("/") or ".." in path:
        raise ValueError("Enter a path starting with /, e.g. /r/python/hot")
    return json.dumps(fetch(path, limit=5), indent=2)[:60000]


# =================================================================
# Reader (powers the built-in Reddit viewer; not listed as tools)
# =================================================================
def _u(x):
    return (x or "").replace("&amp;", "&")


def _video_of(d):
    for src in [d] + list(d.get("crosspost_parent_list") or [])[:1]:
        v = ((src.get("secure_media") or src.get("media") or {}) or {}).get("reddit_video")
        if v and v.get("fallback_url"):
            return {"mp4": v["fallback_url"], "hls": v.get("hls_url"),
                    "w": v.get("width"), "h": v.get("height")}
    pv = (d.get("preview") or {}).get("reddit_video_preview")
    if pv and pv.get("fallback_url"):
        return {"mp4": pv["fallback_url"], "hls": pv.get("hls_url"),
                "w": pv.get("width"), "h": pv.get("height")}
    return None


def norm_post(d):
    link = _u(d.get("url_overridden_by_dest") or d.get("url") or "")
    prev = ((d.get("preview") or {}).get("images") or [{}])[0]
    src = _u((prev.get("source") or {}).get("url"))
    thumb = ""
    for r in prev.get("resolutions") or []:
        thumb = _u(r.get("url"))
        if (r.get("width") or 0) >= 320:
            break
    thumb = thumb or src
    if not thumb and str(d.get("thumbnail", "")).startswith("http"):
        thumb = d["thumbnail"]
    media = {"type": "link", "images": [], "video": None, "link": link}
    vid = _video_of(d)
    gif_mp4 = _u(((prev.get("variants") or {}).get("mp4") or {}).get("source", {}).get("url"))
    if vid:
        media.update(type="video", video=vid)
    elif d.get("is_gallery") and d.get("media_metadata"):
        media.update(type="gallery",
                     images=[m["url"] for m in media_links(d) if m["type"] == "gallery image"])
        if not thumb and media["images"]:
            thumb = media["images"][0]
    elif d.get("is_self"):
        media["type"] = "text"
    elif re.search(r"\.gifv?(\?|$)", link, re.I) and gif_mp4:
        media.update(type="video", video={"mp4": gif_mp4, "hls": None, "gif": True})
    elif re.search(r"\.(jpe?g|png|gif|webp)(\?|$)", link, re.I) or d.get("post_hint") == "image":
        media.update(type="image", images=[link if re.search(r"\.(jpe?g|png|gif|webp)", link, re.I) else src])
    elif link.endswith(".gifv"):
        media.update(type="video", video={"mp4": link[:-5] + ".mp4", "hls": None, "gif": True})
    return {"id": d.get("id"), "title": d.get("title", ""), "subreddit": d.get("subreddit", ""),
            "author": d.get("author", ""), "score": d.get("score"),
            "comments": d.get("num_comments"), "created_utc": d.get("created_utc", 0),
            "url": BASE + d.get("permalink", ""), "domain": d.get("domain", ""),
            "flair": d.get("link_flair_text") or "", "nsfw": bool(d.get("over_18")),
            "spoiler": bool(d.get("spoiler")), "stickied": bool(d.get("stickied")),
            "thumb": thumb, "media": media, "has_body": bool(d.get("selftext"))}


def parse_target(t):
    t = str(t or "").strip()
    if not t:
        return "sub", "popular"
    if t.lower() in ("home", "saved"):
        return t.lower(), ""
    if re.search(r"/s/[A-Za-z0-9]+", t):
        raise ValueError("Share links (with /s/) can't be opened here. Open it in your browser, "
                         "then copy the full link from the address bar.")
    if re.search(r"comments/[a-z0-9]+|redd\.it/", t, re.I):
        return "post", _post_id(t)
    m = re.search(r"(?:^|/)(?:u|user)/([A-Za-z0-9_\-]+)", t)
    if m:
        return "user", m.group(1)
    m = re.search(r"(?:^|/)r/([A-Za-z0-9_+\-]+)", t)
    if m:
        return "sub", m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_+\-]+", t):
        return "sub", t
    raise ValueError("Type a subreddit (python), a user (u/name), or paste a Reddit link.")


def reader_listing(target, sort="hot", t="day", after=None):
    kind, name = parse_target(target)
    if kind == "post":
        return {"open_post": name}
    if kind in ("home", "saved"):
        if kind == "home":
            data = fetch("/", limit=25, after=after)
            title = "Home"
        else:
            if not _signed_client() or not SIGNED["user"]:
                raise RuntimeError("Sign in first to see your saved posts (see the account button, top right).")
            data = fetch(f"/user/{SIGNED['user']}/saved", limit=25, after=after)
            title = "Saved"
        return {"kind": kind, "name": kind, "title": title, "limited": False, "signed_in": True,
                "posts": [norm_post(d) for d in children(data, "t3")],
                "after": (data.get("data") or {}).get("after")}
    if kind == "user":
        s = sort if sort in ("new", "top", "hot", "controversial") else "new"
        data = fetch(f"/user/{name}/submitted", sort=s, limit=25, after=after,
                     t=t if s in ("top", "controversial") else None)
        title = f"u/{name}"
    else:
        s = sort if sort in SORTS else "hot"
        data = fetch(f"/r/{name}/{s}", limit=25, after=after,
                     t=t if s in ("top", "controversial") else None)
        title = f"r/{name}"
    return {"kind": kind, "name": name, "title": title, "limited": MODE["rss"] and not (_signed_client() and not SIGNED["error"]),
            "posts": [norm_post(d) for d in children(data, "t3")],
            "after": (data.get("data") or {}).get("after")}


def _cmts(nodes):
    out = []
    for n in nodes:
        if n.get("kind") == "more":
            cnt = (n.get("data") or {}).get("count", 0)
            if cnt:
                out.append({"more": cnt})
            continue
        if n.get("kind") != "t1":
            continue
        c = n["data"]
        rep = c.get("replies")
        out.append({"id": c.get("id"), "author": c.get("author"), "score": c.get("score"),
                    "created_utc": c.get("created_utc", 0), "body_html": c.get("body_html") or "",
                    "is_op": bool(c.get("is_submitter")), "stickied": bool(c.get("stickied")),
                    "flair": c.get("author_flair_text") or "",
                    "children": _cmts(rep["data"]["children"]) if isinstance(rep, dict) else []})
    return out


def reader_thread(ref, sort="top"):
    s = sort if sort in ("top", "best", "new", "controversial", "old", "qa") else "top"
    data = fetch(f"/comments/{_post_id(ref)}", sort=s, limit=200)
    d = children(data[0], "t3")[0]
    post = norm_post(d)
    post["body_html"] = d.get("selftext_html") or ""
    return {"post": post, "comments": _cmts(data[1]["data"]["children"]),
            "limited": MODE["rss"] and not (_signed_client() and not SIGNED["error"])}
