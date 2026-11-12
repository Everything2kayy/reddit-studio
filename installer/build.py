"""Build the double-click installer and release zip.

    python3 installer/build.py        ->  dist/Reddit-Studio-<version>.zip

The installer embeds every file in app/, so a fresh Mac needs nothing else.
After the first install, the app updates itself from GitHub releases (tags).
"""
import base64
import os
import stat
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")
DIST = os.path.join(ROOT, "dist")
END = "RS_FILE_END_7Q"
TEXT = (".py", ".txt", ".html", ".json")


def embedded_files():
    parts = []
    for root, dirs, files in os.walk(APP):
        dirs[:] = sorted(d for d in dirs if d != "__pycache__")
        for f in sorted(files):
            if f.endswith(".pyc") or f == ".DS_Store":
                continue
            src = os.path.join(root, f)
            rel = os.path.relpath(src, APP)
            data = open(src, "rb").read()
            if rel.endswith(TEXT) and not rel.startswith("static/"):
                body = data.decode()
                assert END not in body, rel
                parts.append(f"  cat > \"$DIR/{rel}\" <<'{END}'\n{body.rstrip(chr(10))}\n{END}\n")
            else:
                b64 = base64.encodebytes(data).decode().rstrip("\n")
                parts.append(f"  base64 --decode > \"$DIR/{rel}\" <<'{END}'\n{b64}\n{END}\n")
    return "".join(parts)


def main():
    version = open(os.path.join(APP, "VERSION")).read().strip()
    tpl = open(os.path.join(ROOT, "installer", "launcher.template.sh")).read()
    launcher = tpl.replace("__VERSION__", version).replace("__FILES__\n", embedded_files())
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, f"Reddit-Studio-{version}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        def add(name, data, mode=0o644):
            info = zipfile.ZipInfo(f"Reddit Studio/{name}", date_time=(2026, 1, 1, 0, 0, 0))
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
        add("Reddit Studio.command", launcher, 0o755)
        add("READ ME FIRST.txt", open(os.path.join(ROOT, "installer", "READ ME FIRST.txt")).read())
        add("feed-studio.user.js", open(os.path.join(ROOT, "extras", "feed-studio.user.js")).read())
    print(out)


if __name__ == "__main__":
    main()
