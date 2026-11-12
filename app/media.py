"""Bulk media downloader (in the spirit of gallery-dl / BDFR, built in).

Saves images, galleries and videos from a community, user, custom feed or single post
into ~/Reddit Studio Files/Media/<feed>/. Handles i.redd.it, Reddit galleries, v.redd.it
(with sound when ffmpeg is installed), Imgur direct links and .gifv, and RedGIFs.
Files that already exist are skipped, so running it again only fetches what's new.
One download job runs at a time; the UI polls status().
"""
import html
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from urllib.request import Request

import network
import reddit_tools as rt

ROOT = os.path.expanduser("~/Reddit Studio Files/Media")
UA = "macos:reddit-studio:media (personal, read-only)"
_lock = threading.Lock()
JOB = {"running": False, "target": "", "total": 0, "done": 0, "saved": 0, "skipped": 0, "failed": 0,
       "bytes": 0, "folder": "", "log": [], "cancel": False, "started": 0.0, "ended": 0.0}


def _log(t):
    JOB["log"].append(t)
    del JOB["log"][:-300]


def status():
    return {k: (v[-60:] if k == "log" else v) for k, v in JOB.items()}


def cancel():
    JOB["cancel"] = True
    return status()


def _safe(name):
    return re.sub(r"[^A-Za-z0-9_+\-]+", "_", name).strip("_")[:80] or "feed"


def _ext(url, default=".jpg"):
    m = re.search(r"\.(jpe?g|png|gif|webp|mp4|webm)(?:\?|$)", url, re.I)
    return "." + m.group(1).lower().replace("jpeg", "jpg") if m else default


def media_items(d):
    """[(url, ext, kind, audio_url_or_None)] for one post's data dict."""
    out = []
    u = html.unescape(d.get("url_overridden_by_dest") or d.get("url") or "")
    vid = ((d.get("secure_media") or d.get("media") or {}) or {}).get("reddit_video")
    if vid and vid.get("fallback_url"):
        v = vid["fallback_url"].split("?")[0]
        base = v.rsplit("/", 1)[0]
        out.append((v, ".mp4", "video", [base + "/DASH_AUDIO_128.mp4", base + "/DASH_audio.mp4", base + "/audio"]))
        return out
    meta = d.get("media_metadata") or {}
    if d.get("is_gallery") and meta:
        order = [it.get("media_id") for it in (d.get("gallery_data") or {}).get("items") or []] or list(meta)
        for mid in order:
            s = (meta.get(mid) or {}).get("s") or {}
            src = html.unescape(s.get("mp4") or s.get("gif") or s.get("u") or "")
            if src:
                out.append((src, _ext(src, ".jpg"), "gallery", None))
        return out
    rid = rt.redgifs_id(u)
    if rid:
        try:
            r = rt.redgifs_urls(rid)
            out.append((r["hd"] or r["sd"], ".mp4", "redgifs", None))
        except Exception as e:
            out.append((None, ".mp4", f"redgifs ({e})", None))
        return out
    if re.search(r"i\.imgur\.com/.+\.gifv$", u, re.I):
        return [(u[:-5] + ".mp4", ".mp4", "video", None)]
    if re.search(r"\.(jpe?g|png|gif|webp|mp4)(\?|$)", u, re.I):
        return [(u, _ext(u), "image" if not u.lower().endswith(".mp4") else "video", None)]
    prev = ((d.get("preview") or {}).get("images") or [{}])[0]
    mp4 = ((prev.get("variants") or {}).get("mp4") or {}).get("source", {}).get("url")
    if mp4:
        return [(html.unescape(mp4), ".mp4", "gif", None)]
    if d.get("post_hint") == "image" and (prev.get("source") or {}).get("url"):
        src = html.unescape(prev["source"]["url"])
        return [(src, _ext(src), "image", None)]
    return out


def _download(url, dest):
    req = Request(url, headers={"User-Agent": UA, "Referer": "https://www.reddit.com/"})
    tmp = dest + ".part"
    n = 0
    with network.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(256 * 1024)
            if not chunk:
                break
            f.write(chunk)
            n += len(chunk)
            if JOB["cancel"]:
                raise RuntimeError("cancelled")
    os.replace(tmp, dest)
    return n


def _merge_audio(video, audio_urls):
    ff = shutil.which("ffmpeg") or next((p for p in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg") if os.path.exists(p)), None)
    if not ff:
        return False
    with tempfile.TemporaryDirectory() as td:
        a = os.path.join(td, "a.mp4")
        for au in audio_urls:
            try:
                _download(au, a)
                break
            except Exception:
                continue
        else:
            return False
        out = os.path.join(td, "out.mp4")
        r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", video, "-i", a, "-c", "copy", out],
                           capture_output=True, timeout=300)
        if r.returncode == 0 and os.path.exists(out):
            os.replace(out, video)
            return True
    return False


def _posts_for(target, sort, t, limit):
    """Collect post dicts from a feed target like r/pics, r/a+b, u/name, a post link/id, or a RedGIFs link."""
    rid = rt.redgifs_id(target)
    if rid:
        return [{"id": rid, "url": f"https://www.redgifs.com/watch/{rid}", "created_utc": time.time(), "title": rid, "over_18": True}]
    m = re.search(r"comments/([a-z0-9]+)", target) or re.fullmatch(r"([a-z0-9]{5,8})", target)
    if m:
        data = rt.fetch(f"/comments/{m.group(1)}", limit=1)
        return [c["data"] for c in data[0]["data"]["children"] if c["kind"] == "t3"]
    tgt = target.strip().strip("/")
    if tgt.startswith("u/") or tgt.startswith("user/"):
        path = "/user/" + tgt.split("/", 1)[1] + "/submitted"
    else:
        path = "/r/" + tgt.split("/", 1)[1] if tgt.startswith("r/") else "/r/" + tgt
        path += "/" + (sort if sort in rt.SORTS else "hot")
    posts, after = [], None
    while len(posts) < limit:
        params = {"limit": min(100, limit - len(posts))}
        if sort in ("top", "controversial"):
            params["t"] = t or "week"
        if after:
            params["after"] = after
        data = rt.fetch(path, **params)
        kids = [c["data"] for c in data["data"]["children"] if c["kind"] == "t3"]
        posts += kids
        after = data["data"].get("after")
        if not after or not kids:
            break
    return posts[:limit]


def start(target, sort="hot", t="week", limit=50, kinds=("image", "gallery", "video", "redgifs", "gif"), nsfw=True):
    target = (target or "").strip()
    if not target:
        raise ValueError("Pick a community, user, or post to download from.")
    limit = max(1, min(int(limit or 50), 1000))
    with _lock:
        if JOB["running"]:
            raise RuntimeError(f"Already downloading {JOB['target']}. Wait for it or press Stop.")
        folder = os.path.join(ROOT, _safe(target.replace("/", "_")))
        JOB.update(running=True, target=target, total=0, done=0, saved=0, skipped=0, failed=0, bytes=0,
                   folder=folder, log=[], cancel=False, started=time.time(), ended=0.0)
    threading.Thread(target=_run, args=(target, sort, t, limit, set(kinds), nsfw, folder), daemon=True).start()
    return status()


def _run(target, sort, t, limit, kinds, nsfw, folder):
    try:
        os.makedirs(folder, exist_ok=True)
        _log(f"Collecting up to {limit} posts from {target}…")
        posts = _posts_for(target, sort, t, limit)
        if not nsfw:
            posts = [p for p in posts if not p.get("over_18")]
        jobs = []
        for d in posts:
            items = media_items(d)
            stamp = time.strftime("%Y-%m-%d", time.localtime(d.get("created_utc") or 0))
            for i, (url, ext, kind, audio) in enumerate(items):
                base_kind = kind.split(" ")[0]
                if base_kind not in kinds and not (base_kind == "gallery" and "image" in kinds):
                    continue
                name = f"{stamp}_{d.get('id')}" + (f"_{i + 1:02d}" if len(items) > 1 else "") + ext
                jobs.append((url, os.path.join(folder, name), kind, audio, d.get("title", "")))
        JOB["total"] = len(jobs)
        _log(f"{len(posts)} posts, {len(jobs)} media files to check.")
        for url, dest, kind, audio, title in jobs:
            if JOB["cancel"]:
                _log("Stopped.")
                break
            JOB["done"] += 1
            if not url:
                JOB["failed"] += 1
                _log(f"✗ {os.path.basename(dest)}: {kind}")
                continue
            if os.path.exists(dest):
                JOB["skipped"] += 1
                continue
            try:
                JOB["bytes"] += _download(url, dest)
                extra = ""
                if audio:
                    extra = " (with sound)" if _merge_audio(dest, audio) else " (no sound: install ffmpeg for audio)"
                JOB["saved"] += 1
                _log(f"✓ {os.path.basename(dest)}{extra}")
            except Exception as e:
                JOB["failed"] += 1
                try:
                    os.remove(dest + ".part")
                except OSError:
                    pass
                _log(f"✗ {os.path.basename(dest)}: {e}")
            time.sleep(0.15)
        _log(f"Finished: {JOB['saved']} saved, {JOB['skipped']} already had, {JOB['failed']} failed → {folder}")
    except Exception as e:
        _log(f"Couldn't download: {e}")
    finally:
        JOB.update(running=False, ended=time.time())


def open_folder(path=None):
    p = path or JOB.get("folder") or ROOT
    os.makedirs(p, exist_ok=True)
    if os.uname().sysname == "Darwin":
        subprocess.Popen(["open", p], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {"folder": p}
