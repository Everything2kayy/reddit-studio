"""Keep Downloads tidy: move Reddit Studio's own files into ~/Reddit Studio Files.

Only files this app made or sent you are touched, matched by exact name patterns:
  reddit-studio-X.Y.Z.patch      update files     -> Updates/Inbox (not yet published) or Updates/Applied
  reddit-studio*.zip / .bundle   project snapshots -> Archive
  Reddit-Studio-X.Y.Z.zip        installers        -> Installers
  "Reddit Studio" folder         unzipped installer -> Installers
  reddit-studio (git folder)     your source copy  -> Source/reddit-studio
  reddit-studio-settings*.json   settings exports  -> Exports
Old copies are pruned (newest kept) so the folder doesn't grow forever. Anything else in
Downloads is never moved or deleted.
"""
import glob
import json
import os
import re
import shutil
import time

HERE = os.path.dirname(os.path.abspath(__file__))
KEEP = {"Updates/Applied": 10, "Archive": 3, "Installers": 2}


def paths(home=None):
    home = home or os.path.expanduser("~")
    root = os.path.join(home, "Reddit Studio Files")
    return {"home": home, "downloads": os.path.join(home, "Downloads"), "root": root,
            "inbox": os.path.join(root, "Updates", "Inbox"), "applied": os.path.join(root, "Updates", "Applied"),
            "archive": os.path.join(root, "Archive"), "installers": os.path.join(root, "Installers"),
            "exports": os.path.join(root, "Exports"), "source": os.path.join(root, "Source")}


def _ver(name):
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", name)
    return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)


def _read(p):
    try:
        with open(p) as f:
            return f.read().strip()
    except OSError:
        return ""


def _free(dest):
    """A destination path that doesn't overwrite anything."""
    if not os.path.exists(dest):
        return dest
    base, ext = os.path.splitext(dest)
    n = 2
    while os.path.exists(f"{base} ({n}){ext}"):
        n += 1
    return f"{base} ({n}){ext}"


def _size(p):
    if os.path.isfile(p):
        return os.path.getsize(p)
    total = 0
    for dp, _, fs in os.walk(p):
        for f in fs:
            try:
                total += os.path.getsize(os.path.join(dp, f))
            except OSError:
                pass
    return total


def _human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024


def _is_source(p):
    return (os.path.isdir(os.path.join(p, ".git")) and os.path.exists(os.path.join(p, "app", "update.json"))
            and os.path.exists(os.path.join(p, "installer", "build.py")))


def _is_installer_folder(p):
    return os.path.isdir(p) and os.path.exists(os.path.join(p, "Reddit Studio.command"))


def plan(home=None, source_version=None):
    """What would be moved. Returns a list of (src, dest_dir, reason)."""
    P = paths(home)
    dl = P["downloads"]
    if not os.path.isdir(dl):
        return []
    cur = _ver(source_version) if source_version else None
    out = []
    for name in sorted(os.listdir(dl)):
        src = os.path.join(dl, name)
        low = name.lower()
        if name.startswith("Reddit-Studio-") and low.endswith(".zip"):
            out.append((src, P["installers"], "installer"))
        elif re.fullmatch(r"reddit-studio-\d+\.\d+\.\d+( \(\d+\))?\.patch", low):
            out.append((src, P["applied"] if cur and _ver(name) <= cur else P["inbox"], "update file"))
        elif re.fullmatch(r"reddit-studio(-\d+\.\d+\.\d+)?( \(\d+\))?\.(zip|bundle)", low):
            out.append((src, P["archive"], "project snapshot"))
        elif name == "Reddit Studio" and _is_installer_folder(src):
            out.append((src, P["installers"], "unzipped installer"))
        elif name == "reddit-studio" and _is_source(src):
            if not os.path.isdir(os.path.join(src, ".git", "rebase-apply")):
                out.append((src, P["source"], "source folder"))
        elif re.fullmatch(r"reddit-studio-settings( \(\d+\))?\.json", low):
            out.append((src, P["exports"], "settings export"))
    return out


def _prune(folder, keep, log):
    if not os.path.isdir(folder):
        return 0
    items = [os.path.join(folder, x) for x in os.listdir(folder) if not x.startswith(".")]
    items.sort(key=lambda p: (_ver(os.path.basename(p)), os.path.getmtime(p)), reverse=True)
    freed = 0
    for old in items[keep:]:
        freed += _size(old)
        if os.path.isdir(old):
            shutil.rmtree(old, ignore_errors=True)
        else:
            try:
                os.remove(old)
            except OSError:
                continue
        log(f"  removed old copy: {os.path.basename(old)}")
    return freed


def run(home=None, source_version=None, log=print, on_source_moved=None):
    """Move files, prune old copies, write a README. Returns a summary dict."""
    P = paths(home)
    moved, freed = [], 0
    for src, dest_dir, why in plan(home, source_version):
        os.makedirs(dest_dir, exist_ok=True)
        name = os.path.basename(src)
        if why == "unzipped installer":
            v = _read(os.path.join(src, "app", "VERSION")) or time.strftime("%Y%m%d")
            name = f"Reddit Studio installer {v}"
        if why == "source folder" and os.path.exists(os.path.join(dest_dir, name)):
            log(f"Skipped {name}: there's already a source folder in {dest_dir}.")
            continue
        dest = _free(os.path.join(dest_dir, name))
        try:
            shutil.move(src, dest)
        except OSError as e:
            log(f"Couldn't move {name}: {e}")
            continue
        moved.append({"name": os.path.basename(src), "to": dest, "why": why})
        log(f"Moved {os.path.basename(src)} → {os.path.relpath(dest, P['home'])}  ({why})")
        if why == "source folder" and on_source_moved:
            on_source_moved(dest)
    for rel, keep in KEEP.items():
        freed += _prune(os.path.join(P["root"], rel), keep, log)
    # inbox files that are already applied move to Applied
    if source_version and os.path.isdir(P["inbox"]):
        for f in glob.glob(os.path.join(P["inbox"], "*.patch")):
            if _ver(os.path.basename(f)) <= _ver(source_version):
                os.makedirs(P["applied"], exist_ok=True)
                shutil.move(f, _free(os.path.join(P["applied"], os.path.basename(f))))
    # the installed app's backups: keep the newest 3
    freed += _prune(os.path.join(HERE, ".old"), 3, log) if os.path.isdir(os.path.join(HERE, ".old")) else 0
    # old built installers inside the source folder's dist/
    src_dirs = [os.path.join(P["source"], "reddit-studio")]
    for s in src_dirs:
        freed += _prune(os.path.join(s, "dist"), 2, log) if os.path.isdir(os.path.join(s, "dist")) else 0
    if moved or os.path.isdir(P["root"]):
        os.makedirs(P["root"], exist_ok=True)
        with open(os.path.join(P["root"], "README.txt"), "w") as f:
            f.write("Reddit Studio Files\n\nReddit Studio keeps its own files here so your Downloads folder stays clean.\n\n"
                    "Updates/Inbox    update files not published yet (the Helper picks them up from here)\n"
                    "Updates/Applied  update files already published (newest 10 kept)\n"
                    "Installers       installer zips and unzipped installer folders (newest 2 kept)\n"
                    "Archive          project snapshots (newest 3 kept)\n"
                    "Exports          settings exports\n"
                    "Source           your Reddit Studio source folder (the one you publish from)\n\n"
                    "Turn this off in Reddit Studio: Helper › Tidy Downloads automatically.\n")
    summary = {"moved": moved, "freed": freed, "freed_text": _human(freed), "root": P["root"], "at": time.time()}
    log(f"\nTidy: moved {len(moved)} item(s), freed {_human(freed)}. Files are in {P['root']}")
    return summary


def clutter(home=None, source_version=None):
    return [{"name": os.path.basename(s), "why": w} for s, _, w in plan(home, source_version)]
