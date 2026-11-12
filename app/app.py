import hmac
import os
import secrets
import socket
import threading

from flask import Flask, jsonify, redirect, render_template, request, send_from_directory

import reddit_tools as rt
import helper
import bridge
import updater
from reddit_tools import REGISTRY

app = Flask(__name__)
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
PHONE_PORT = 5056
LOCAL = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}

# Phone access: a second listener on your Wi-Fi, off by default. A fresh secret
# code is made each time it's turned on; only devices that scanned the QR get in.
phone = {"on": False, "token": "", "server": None, "url": ""}


def _is_local():
    return request.remote_addr in LOCAL and request.host.split(":")[0] in ("127.0.0.1", "localhost")


def _lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))     # no packet is sent; this just picks the Wi-Fi interface
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


@app.before_request
def gate():
    if _is_local():
        return None
    if not phone["on"]:
        return "Phone access is turned off. Turn it on in Reddit Studio on your computer.", 403
    if request.path == "/login":
        if hmac.compare_digest(request.args.get("t", ""), phone["token"]):
            resp = redirect("/#/r/popular")
            resp.set_cookie("rs_t", phone["token"], httponly=True, samesite="Lax", max_age=30 * 86400)
            return resp
        return "This QR code has expired. Scan the new one shown in Reddit Studio.", 403
    if not hmac.compare_digest(request.cookies.get("rs_t", ""), phone["token"]):
        return ("Not signed in. Open Reddit Studio on your computer, click Phone, "
                "and scan the QR code."), 401
    if request.path.startswith(("/api/phone", "/api/update", "/api/signin", "/api/apikey", "/api/helper")) and request.method != "GET":
        return "Only the computer can change this setting.", 403
    return None


def _wrap(fn):
    try:
        return jsonify(ok=True, result=fn())
    except (ValueError, RuntimeError) as e:
        return jsonify(ok=False, error=str(e)), 400
    except Exception as e:
        return jsonify(ok=False, error=f"{type(e).__name__}: {e}"), 500


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/sw.js")
def service_worker():
    resp = send_from_directory(STATIC, "sw.js", mimetype="application/javascript")
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/manifest.webmanifest")
def manifest():
    return send_from_directory(STATIC, "manifest.webmanifest", mimetype="application/manifest+json")


@app.get("/api/tools")
def list_tools():
    return jsonify([{k: v for k, v in t.items() if k != "fn"} for t in REGISTRY.values()])


@app.post("/api/run/<tool_id>")
def run_tool(tool_id):
    tool = REGISTRY.get(tool_id)
    if not tool:
        return jsonify(ok=False, error="Unknown tool"), 404
    params = request.get_json(silent=True) or {}
    return _wrap(lambda: tool["fn"](params))


@app.get("/api/reader/listing")
def reader_listing():
    a = request.args
    return _wrap(lambda: rt.reader_listing(a.get("target", ""), a.get("sort", "hot"),
                                           a.get("t", "day"), a.get("after") or None))


@app.get("/api/reader/thread")
def reader_thread():
    a = request.args
    return _wrap(lambda: rt.reader_thread(a.get("ref", ""), a.get("sort", "top")))


# ---------- version & updates ----------
@app.get("/api/version")
def version():
    return jsonify(ok=True, result={"version": updater.current_version()})


@app.get("/api/update")
def update_status():
    return _wrap(updater.status)


@app.post("/api/update/check")
def update_check():
    def go():
        _from_app()
        return updater.check(force=True)
    return _wrap(go)


@app.post("/api/update/install")
def update_install():
    def go():
        _from_app()
        if updater.STATE["installing"]:
            return updater.status()
        threading.Thread(target=updater.install, daemon=True).start()
        updater.STATE["installing"] = True
        return updater.status()
    return _wrap(go)


@app.post("/api/update/settings")
def update_settings():
    def go():
        _from_app()
        body = request.get_json(silent=True) or {}
        if "auto_install" in body:
            updater.save_user_setting("auto_install", bool(body["auto_install"]))
        return updater.status()
    return _wrap(go)


@app.post("/api/restart")
def restart():
    def go():
        _from_app()
        updater.STATE["restart_pending"] = True
        return {"restarting": bool(app.config.get("CAN_RESTART"))}
    return _wrap(go)


@app.get("/api/status")
def status():
    return _wrap(rt.signed_status)


@app.post("/api/signin/<onoff>")
def signin_toggle(onoff):
    def go():
        _from_app()
        rt.SIGNED["off"] = (onoff == "off")
        rt._cache.clear()
        return rt.signed_status()
    return _wrap(go)


@app.post("/api/apikey")
def apikey_set():
    def go():
        _from_app()
        d = request.get_json(silent=True) or {}
        return rt.api_set(d.get("client_id"), d.get("client_secret"), d.get("username", ""))
    return _wrap(go)


@app.post("/api/apikey/clear")
def apikey_clear():
    def go():
        _from_app()
        return rt.api_clear()
    return _wrap(go)


# ---------- helper: one-click actions + suggestions ----------
helper.AFTER.append(lambda action, ok: (rt._cache.clear(), rt.SIGNED.update(mtime=None, error=None)) if ok else None)


@app.get("/api/helper")
def helper_overview():
    return _wrap(lambda: helper.overview(rt.signed_status(), request.args.get("err", "")[:300]) if _is_local() else {"local": False})


@app.post("/api/helper/run/<action>")
def helper_run(action):
    def go():
        _from_app()
        return helper.run(action)
    return _wrap(go)


# ---------- RedGIFs playback ----------
@app.get("/api/redgifs/<rid>.mp4")
def redgifs_video(rid):
    try:
        r = rt.redgifs_urls(rid)
    except (ValueError, RuntimeError) as e:
        return str(e), 404
    want_sd = request.args.get("q") == "sd"
    return redirect((r["sd"] if want_sd else r["hd"]) or r["sd"], code=302)


# ---------- Chrome extension bridge ----------
@app.post("/api/bridge/checkin")
def bridge_checkin():
    def go():
        _from_app()
        if not _is_local():
            raise RuntimeError("Only on this computer.")
        d = request.get_json(silent=True) or {}
        return bridge.checkin(d.get("version", ""), d.get("tab", ""), d.get("user", ""))
    return _wrap(go)


@app.post("/api/bridge/result/<int:jid>")
def bridge_result(jid):
    def go():
        _from_app()
        if not _is_local():
            raise RuntimeError("Only on this computer.")
        d = request.get_json(silent=True) or {}
        return bridge.deliver(jid, d.get("data"), d.get("error"), d.get("status"))
    return _wrap(go)


@app.get("/api/bridge")
def bridge_status():
    return _wrap(bridge.status)


# ---------- phone access ----------
def _phone_status():
    st = {"local": _is_local(), "on": phone["on"]}
    if phone["on"] and _is_local():
        import qrcode
        import qrcode.image.svg
        img = qrcode.make(phone["url"], image_factory=qrcode.image.svg.SvgPathImage, box_size=10)
        st.update(url=phone["url"], qr_svg=img.to_string(encoding="unicode"))
    return st


@app.get("/api/phone")
def phone_status():
    return _wrap(_phone_status)


def _from_app():
    # A custom header can only be sent by this app's own page, not by other websites.
    if request.headers.get("X-Reddit-Studio") != "1":
        raise RuntimeError("Blocked: request didn't come from Reddit Studio.")


@app.post("/api/phone/on")
def phone_on():
    def go():
        _from_app()
        if not phone["on"]:
            ip = _lan_ip()
            if not ip or ip.startswith("127."):
                raise RuntimeError("Your computer doesn't seem to be on a Wi-Fi or local network.")
            from werkzeug.serving import make_server
            try:
                srv = make_server("0.0.0.0", PHONE_PORT, app, threaded=True)
            except OSError:
                raise RuntimeError(f"Port {PHONE_PORT} is busy. Close whatever is using it and try again.")
            phone.update(on=True, token=secrets.token_urlsafe(18), server=srv,
                         url=f"http://{ip}:{PHONE_PORT}/login?t=")
            phone["url"] += phone["token"]
            threading.Thread(target=srv.serve_forever, daemon=True).start()
        return _phone_status()
    return _wrap(go)


@app.post("/api/phone/off")
def phone_off():
    def go():
        _from_app()
        srv = phone.get("server")
        phone.update(on=False, token="", server=None, url="")
        if srv:
            threading.Thread(target=srv.shutdown, daemon=True).start()
        return _phone_status()
    return _wrap(go)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5055, debug=False)
