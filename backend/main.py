#!/usr/bin/env python3
"""Ironicles — a private, self-hosted period and cycle tracker.

One SQLite file, a small JSON API, and a mobile web app served from the same process.
Run: uvicorn main:app --host 0.0.0.0 --port 8889
"""
from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import io
import json
import math
import os
import secrets
import sqlite3
import time
from collections import defaultdict, deque
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(__file__).parent / "static"
DB_PATH = Path(os.environ.get("IRONICLES_DB", str(ROOT / "data" / "ironicles.db")))
ENV_PASSCODE = os.environ.get("IRONICLES_PASSCODE", "")
SESSION_DAYS = int(os.environ.get("IRONICLES_SESSION_DAYS", "180"))
VERSION = "1.0.0"

FLOW_VALUES = {"none", "spotting", "light", "medium", "heavy"}
FLOW_ORDER = {None: 0, "none": 0, "spotting": 1, "light": 2, "medium": 3, "heavy": 4}
COOKIE = "ironicles_session"

app = FastAPI(title="Ironicles", version=VERSION)


# ------------------------------------------------------------------ storage
def get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(DB_PATH))
    con.row_factory = sqlite3.Row
    return con


def ensure_schema() -> None:
    con = get_db()
    con.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS entries (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            day           TEXT NOT NULL,
            flow          TEXT,
            symptoms_json TEXT,
            mood          TEXT,
            notes         TEXT,
            extras_json   TEXT,
            moon_json     TEXT,
            created_at    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_entries_day ON entries(day);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    con.commit()
    con.close()


def setting(key: str, default=None):
    con = get_db()
    row = con.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    con.close()
    return json.loads(row["value"]) if row else default


def set_setting(key: str, value) -> None:
    con = get_db()
    if value is None:
        con.execute("DELETE FROM settings WHERE key=?", (key,))
    else:
        con.execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", (key, json.dumps(value)))
    con.commit()
    con.close()


@app.on_event("startup")
async def startup() -> None:
    ensure_schema()
    if not setting("session_secret"):
        set_setting("session_secret", secrets.token_hex(32))


# --------------------------------------------------------------------- auth
# Optional passcode. Set it in the app (stored as a salted PBKDF2 hash) or pin it with
# IRONICLES_PASSCODE. Unlocking sets a signed, HttpOnly cookie; changing the passcode
# signs every other device out.
def hash_passcode(pw: str) -> dict:
    salt = secrets.token_bytes(16)
    it = 200_000
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, it)
    return {"salt": base64.b64encode(salt).decode(), "iter": it, "hash": base64.b64encode(dk).decode()}


def passcode_record():
    if ENV_PASSCODE:
        return {"env": True}
    return setting("passcode")


def auth_required() -> bool:
    return bool(passcode_record())


def check_passcode(pw: str) -> bool:
    rec = passcode_record()
    if not rec:
        return True
    if rec.get("env"):
        return hmac.compare_digest(pw.encode(), ENV_PASSCODE.encode())
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), base64.b64decode(rec["salt"]), int(rec["iter"]))
    return hmac.compare_digest(dk, base64.b64decode(rec["hash"]))


def _passcode_version() -> str:
    rec = passcode_record() or {}
    if rec.get("env"):
        return hashlib.sha256(("env:" + ENV_PASSCODE).encode()).hexdigest()[:12]
    return (rec.get("salt") or "none")[:12]


def make_token() -> str:
    body = f"{int(time.time())}.{_passcode_version()}"
    sig = hmac.new(setting("session_secret").encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def token_ok(tok: str | None) -> bool:
    if not tok or tok.count(".") != 2:
        return False
    issued, ver, sig = tok.split(".")
    good = hmac.new(setting("session_secret").encode(), f"{issued}.{ver}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, good) or ver != _passcode_version():
        return False
    return issued.isdigit() and time.time() - int(issued) < SESSION_DAYS * 86400


OPEN_API = {"/api/health", "/api/auth", "/api/login"}
_fails: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/"):
        # writes need a header a cross-site form or image can't send
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-ironicles") != "1":
            return JSONResponse({"detail": "missing X-Ironicles header"}, status_code=403)
        if path not in OPEN_API and auth_required() and not token_ok(request.cookies.get(COOKIE)):
            return JSONResponse({"detail": "locked"}, status_code=401)
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    if path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    return resp


def _set_cookie(resp: Response, request: Request, value: str, max_age: int) -> None:
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    resp.set_cookie(COOKIE, value, max_age=max_age, httponly=True, samesite="lax", secure=secure, path="/")


class Login(BaseModel):
    passcode: str


@app.get("/api/auth")
def auth_status(request: Request) -> dict:
    rec = passcode_record()
    return {"required": bool(rec), "unlocked": not rec or token_ok(request.cookies.get(COOKIE)),
            "pinned": bool(rec and rec.get("env")), "version": VERSION}


@app.post("/api/login")
def login(body: Login, request: Request) -> Response:
    ip = request.client.host if request.client else "?"
    q = _fails[ip]
    while q and time.time() - q[0] > 600:
        q.popleft()
    if len(q) >= 8:
        raise HTTPException(429, "Too many tries — wait a few minutes.")
    if not check_passcode(body.passcode):
        q.append(time.time())
        raise HTTPException(401, "That passcode didn't match.")
    q.clear()
    resp = JSONResponse({"ok": True})
    _set_cookie(resp, request, make_token(), SESSION_DAYS * 86400)
    return resp


@app.post("/api/logout")
def logout(request: Request) -> Response:
    resp = JSONResponse({"ok": True})
    _set_cookie(resp, request, "", 0)
    return resp


class PasscodeChange(BaseModel):
    current: Optional[str] = None
    new: Optional[str] = None      # empty / null = turn the passcode off


@app.post("/api/settings/passcode")
def change_passcode(body: PasscodeChange, request: Request) -> Response:
    rec = passcode_record()
    if rec and rec.get("env"):
        raise HTTPException(409, "The passcode is pinned by the server (IRONICLES_PASSCODE).")
    if rec and not check_passcode(body.current or ""):
        raise HTTPException(401, "Your current passcode didn't match.")
    new = (body.new or "").strip()
    if new and len(new) < 4:
        raise HTTPException(400, "Use at least 4 characters.")
    set_setting("passcode", hash_passcode(new) if new else None)
    resp = JSONResponse({"ok": True, "required": bool(new)})
    if new:   # keep this device signed in under the new passcode
        _set_cookie(resp, request, make_token(), SESSION_DAYS * 86400)
    return resp


# ------------------------------------------------------------------- model
def moon_phase(d: date) -> dict:
    ref = datetime(2000, 1, 6, 18, 14)
    dt = datetime(d.year, d.month, d.day)
    age = ((dt - ref).total_seconds() / 86400.0) % 29.53058867
    illum = 0.5 * (1 - math.cos(2 * math.pi * age / 29.53058867))
    if age < 1.84566:    phase = "new"
    elif age < 5.53699:  phase = "waxing_crescent"
    elif age < 9.22831:  phase = "first_quarter"
    elif age < 12.91963: phase = "waxing_gibbous"
    elif age < 16.61096: phase = "full"
    elif age < 20.30228: phase = "waning_gibbous"
    elif age < 23.99361: phase = "last_quarter"
    elif age < 27.68493: phase = "waning_crescent"
    else:                phase = "new"
    return {"ageDays": round(age, 2), "phase": phase, "illumination": round(illum, 3)}


def _extras(raw) -> dict:
    try:
        v = json.loads(raw) if raw else {}
        return v if isinstance(v, dict) else {}
    except ValueError:
        return {}


ENTRY_COLS = "id, day, flow, symptoms_json, mood, notes, moon_json, created_at, extras_json"


def _row_to_entry(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"], "day": r["day"], "flow": r["flow"],
        "symptoms": json.loads(r["symptoms_json"]) if r["symptoms_json"] else [],
        "mood": r["mood"], "notes": r["notes"],
        "moon": json.loads(r["moon_json"]) if r["moon_json"] else None,
        "created_at": r["created_at"], "extras": _extras(r["extras_json"]),
    }


def all_entries() -> list[dict]:
    con = get_db()
    rows = con.execute(f"SELECT {ENTRY_COLS} FROM entries ORDER BY day DESC, id DESC").fetchall()
    con.close()
    return [_row_to_entry(r) for r in rows]


def entries_since(days: int, today: date) -> list[dict]:
    start = (today - timedelta(days=days)).isoformat()
    return [e for e in reversed(all_entries()) if e["day"] >= start]


def period_starts(entries: list[dict]) -> list[str]:
    """A period starts on a day with light/medium/heavy flow after 2+ days without one.
    Calendar days with no entry at all count as days without flow (sparse logs are normal)."""
    flow_yes = {"light", "medium", "heavy"}
    by_day: dict[str, str | None] = {}
    for e in entries:
        d, f = e["day"], e.get("flow") or None
        if d not in by_day or FLOW_ORDER.get(f, 0) > FLOW_ORDER.get(by_day[d], 0):
            by_day[d] = f
    starts: list[str] = []
    non_run = 99
    prev_day: str | None = None
    for d in sorted(by_day):
        if prev_day is not None:
            gap = (date.fromisoformat(d) - date.fromisoformat(prev_day)).days - 1
            if gap > 0:
                non_run = min(non_run + gap, 999)
        f = by_day[d]
        if f in flow_yes:
            if non_run >= 2:
                starts.append(d)
            non_run = 0
        else:
            non_run += 1
        prev_day = d
    return starts


def compute_prediction(starts: list[str], today: date) -> tuple[str | None, int | None]:
    """Next start = last start + the median of the last six cycle lengths (28 with one start)."""
    if not starts:
        return None, None
    if len(starts) == 1:
        pred = date.fromisoformat(starts[-1]) + timedelta(days=28)
    else:
        lengths = sorted([(date.fromisoformat(b) - date.fromisoformat(a)).days
                          for a, b in zip(starts, starts[1:])][-6:])
        pred = date.fromisoformat(starts[-1]) + timedelta(days=lengths[len(lengths) // 2])
    return pred.isoformat(), (pred - today).days


def client_today(request: Request | None) -> date:
    """The phone's own date (?today=YYYY-MM-DD) so 'today' is right in any timezone."""
    raw = request.query_params.get("today") if request else None
    if raw:
        try:
            d = date.fromisoformat(raw)
            if abs((d - date.today()).days) <= 1:
                return d
        except ValueError:
            pass
    return date.today()


# ----------------------------------------------------------------- models
class LogEntry(BaseModel):
    date: Optional[str] = None
    flow: Optional[str] = None
    symptoms: Optional[List[str]] = []
    mood: Optional[str] = None
    notes: Optional[str] = None
    include_moon: bool = True
    extras: Optional[dict] = None     # {"pain": 0-10}; omitted on PUT = leave as is


def clean_extras(extras: Optional[dict]) -> Optional[dict]:
    if extras is None:
        return None
    out = {}
    if extras.get("pain") is not None:
        try:
            pain = int(extras["pain"])
        except (TypeError, ValueError):
            raise HTTPException(400, "pain must be a number 0-10")
        if not 0 <= pain <= 10:
            raise HTTPException(400, "pain must be 0-10")
        out["pain"] = pain
    return out


def _validate(entry: LogEntry) -> tuple[str, str | None, list[str], dict | None, dict | None]:
    day = entry.date or date.today().isoformat()
    try:
        date.fromisoformat(day)
    except ValueError:
        raise HTTPException(400, "Invalid date, expected YYYY-MM-DD")
    flow = (entry.flow or "").lower() or None
    if flow and flow not in FLOW_VALUES:
        raise HTTPException(400, f"Invalid flow '{flow}'")
    symptoms = [s.strip()[:80] for s in (entry.symptoms or []) if s and s.strip()][:40]
    mphase = moon_phase(date.fromisoformat(day)) if entry.include_moon else None
    return day, flow, symptoms, mphase, clean_extras(entry.extras)


# ---------------------------------------------------------------- endpoints
@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "version": VERSION}


@app.get("/api/today")
def get_today(request: Request = None) -> dict:
    today = client_today(request)
    starts = period_starts(entries_since(365, today))
    last_start = starts[-1] if starts else None
    cycle_day = (today - date.fromisoformat(last_start)).days + 1 if last_start else None
    predicted_next, days_until = compute_prediction(starts, today)
    todays = [e for e in all_entries() if e["day"] == today.isoformat()]
    return {"today": today.isoformat(), "cycleDay": cycle_day, "lastPeriodStart": last_start,
            "predictedNext": predicted_next, "daysUntilNext": days_until, "todayEntries": todays,
            "moon": moon_phase(today), "totalStarts": len(starts)}


@app.get("/api/entries")
def list_entries(limit: int = 90, offset: int = 0) -> dict:
    con = get_db()
    rows = con.execute(f"SELECT {ENTRY_COLS} FROM entries ORDER BY day DESC, id DESC LIMIT ? OFFSET ?",
                       (limit, offset)).fetchall()
    con.close()
    return {"entries": [_row_to_entry(r) for r in rows]}


@app.get("/api/summary")
def get_summary(request: Request = None, days: int = 365) -> dict:
    today = client_today(request)
    entries = entries_since(days, today)
    starts = period_starts(entries)
    lengths = [(date.fromisoformat(b) - date.fromisoformat(a)).days for a, b in zip(starts, starts[1:])]
    predicted, days_until = compute_prediction(starts, today)
    counts: dict[str, int] = {}
    for e in entries:
        for s in e.get("symptoms") or []:
            counts[s] = counts.get(s, 0) + 1
    return {"periodStarts": starts, "cycleLengths": lengths,
            "avgLength": round(sum(lengths) / len(lengths), 1) if lengths else None,
            "minLength": min(lengths) if lengths else None, "maxLength": max(lengths) if lengths else None,
            "predictedNext": predicted, "daysUntilNext": days_until,
            "symptomCounts": dict(sorted(counts.items(), key=lambda x: -x[1])), "totalEntries": len(entries)}


@app.get("/api/state")
def get_state(request: Request) -> dict:
    """Everything the app draws, in one round trip."""
    return {"today": get_today(request), "summary": get_summary(request, 730), "entries": all_entries(),
            "serverTime": datetime.now().isoformat(timespec="seconds"), "version": VERSION}


@app.post("/api/log", status_code=201)
def log_entry(entry: LogEntry) -> dict:
    day, flow, symptoms, mphase, extras = _validate(entry)
    con = get_db()
    cur = con.execute(
        "INSERT INTO entries(day, flow, symptoms_json, mood, notes, extras_json, moon_json, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (day, flow, json.dumps(symptoms) if symptoms else None, (entry.mood or "").strip()[:60] or None,
         (entry.notes or "").strip()[:4000] or None, json.dumps(extras) if extras else None,
         json.dumps(mphase) if mphase else None, datetime.now().isoformat(timespec="seconds")))
    con.commit()
    rowid = cur.lastrowid
    con.close()
    return {"ok": True, "id": rowid, "day": day, "flow": flow, "symptoms": symptoms}


@app.put("/api/entries/{entry_id}")
def update_entry(entry_id: int, entry: LogEntry) -> dict:
    day, flow, symptoms, mphase, extras = _validate(entry)
    con = get_db()
    cur = con.execute(
        "UPDATE entries SET day=?, flow=?, symptoms_json=?, mood=?, notes=?, moon_json=? WHERE id=?",
        (day, flow, json.dumps(symptoms) if symptoms else None, (entry.mood or "").strip()[:60] or None,
         (entry.notes or "").strip()[:4000] or None, json.dumps(mphase) if mphase else None, entry_id))
    if extras is not None and cur.rowcount:
        con.execute("UPDATE entries SET extras_json=? WHERE id=?", (json.dumps(extras) if extras else None, entry_id))
    con.commit()
    updated = cur.rowcount
    con.close()
    if not updated:
        raise HTTPException(404, "Entry not found")
    return {"ok": True, "id": entry_id, "day": day, "flow": flow, "symptoms": symptoms}


@app.delete("/api/entries/{entry_id}")
def delete_entry(entry_id: int) -> dict:
    con = get_db()
    cur = con.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
    con.commit()
    deleted = cur.rowcount
    con.close()
    if not deleted:
        raise HTTPException(404, "Entry not found")
    return {"ok": True, "deleted": entry_id}


# ------------------------------------------------------------ export / import
@app.get("/api/export")
def export(format: str = "json") -> Response:
    entries = list(reversed(all_entries()))
    stamp = date.today().isoformat()
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["day", "flow", "symptoms", "mood", "pain", "notes", "created_at"])
        for e in entries:
            w.writerow([e["day"], e["flow"] or "", "; ".join(e["symptoms"]), e["mood"] or "",
                        e["extras"].get("pain", ""), e["notes"] or "", e["created_at"]])
        return Response(buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="ironicles-{stamp}.csv"'})
    body = {"app": "ironicles", "format": 1, "exportedAt": datetime.now().isoformat(timespec="seconds"),
            "entries": [{k: e[k] for k in ("day", "flow", "symptoms", "mood", "notes", "extras", "created_at")}
                        for e in entries]}
    return Response(json.dumps(body, ensure_ascii=False, indent=1), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="ironicles-{stamp}.json"'})


@app.post("/api/import")
async def import_entries(request: Request) -> dict:
    """Restore an export. Entries already present (same day and contents) are skipped."""
    try:
        body = json.loads(await request.body())
        rows = body["entries"]
        assert isinstance(rows, list)
    except Exception:
        raise HTTPException(400, "That isn't an Ironicles export file.")
    key = lambda e: json.dumps([e.get("day"), e.get("flow") or None, sorted(e.get("symptoms") or []),
                                e.get("mood") or None, (e.get("notes") or "").strip() or None])
    have = {key(e) for e in all_entries()}
    added = skipped = bad = 0
    con = get_db()
    for r in rows:
        try:
            entry = LogEntry(date=r.get("day"), flow=r.get("flow"), symptoms=r.get("symptoms") or [], mood=r.get("mood"),
                             notes=r.get("notes"), extras=r.get("extras") or None)
            day, flow, symptoms, mphase, extras = _validate(entry)
        except Exception:
            bad += 1
            continue
        if key({"day": day, "flow": flow, "symptoms": symptoms, "mood": entry.mood, "notes": entry.notes}) in have:
            skipped += 1
            continue
        con.execute(
            "INSERT INTO entries(day, flow, symptoms_json, mood, notes, extras_json, moon_json, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (day, flow, json.dumps(symptoms) if symptoms else None, entry.mood or None, entry.notes or None,
             json.dumps(extras) if extras else None, json.dumps(mphase) if mphase else None,
             r.get("created_at") or datetime.now().isoformat(timespec="seconds")))
        have.add(key({"day": day, "flow": flow, "symptoms": symptoms, "mood": entry.mood, "notes": entry.notes}))
        added += 1
    con.commit()
    con.close()
    return {"ok": True, "added": added, "skipped": skipped, "invalid": bad}


# --------------------------------------------------------------------- page
def _asset_version() -> str:
    h = hashlib.sha1(VERSION.encode())
    for name in ("app.js", "app.css"):
        p = STATIC_DIR / name
        if p.exists():
            h.update(str(p.stat().st_mtime_ns).encode())
    return h.hexdigest()[:10]


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8").replace("{{v}}", _asset_version())
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
