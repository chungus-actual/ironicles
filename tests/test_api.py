"""API tests. Run from the repo root: python tests/test_api.py (needs fastapi + httpx)."""
import os
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

DB = Path(tempfile.mkdtemp(prefix="ironicles-test-")) / "t.db"
os.environ["IRONICLES_DB"] = str(DB)
os.environ.pop("IRONICLES_PASSCODE", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

H = {"X-Ironicles": "1"}
T = date.today()
iso = lambda n: (T + timedelta(days=n)).isoformat()


def client():
    return TestClient(main.app)


def test_health_and_open_auth():
    with client() as c:
        assert c.get("/api/health").json()["ok"]
        a = c.get("/api/auth").json()
        assert a == {"required": False, "unlocked": True, "pinned": False, "version": main.VERSION}
        assert c.get("/").status_code == 200 and "Ironicles" in c.get("/").text and "{{v}}" not in c.get("/").text


def test_writes_need_header():
    with client() as c:
        assert c.post("/api/log", json={"flow": "light"}).status_code == 403


def test_log_edit_delete_and_extras():
    with client() as c:
        r = c.post("/api/log", json={"date": iso(-1), "flow": "medium", "symptoms": ["cramps", " "], "extras": {"pain": 6}}, headers=H)
        assert r.status_code == 201
        eid = r.json()["id"]
        e = next(x for x in c.get("/api/entries").json()["entries"] if x["id"] == eid)
        assert e["symptoms"] == ["cramps"] and e["extras"] == {"pain": 6}
        # PUT without extras keeps them
        assert c.put(f"/api/entries/{eid}", json={"date": iso(-1), "flow": "heavy"}, headers=H).status_code == 200
        e = next(x for x in c.get("/api/entries").json()["entries"] if x["id"] == eid)
        assert e["flow"] == "heavy" and e["extras"] == {"pain": 6}
        assert c.post("/api/log", json={"extras": {"pain": 11}}, headers=H).status_code == 400
        assert c.post("/api/log", json={"flow": "gushing"}, headers=H).status_code == 400
        assert c.delete(f"/api/entries/{eid}", headers=H).status_code == 200
        assert c.delete(f"/api/entries/{eid}", headers=H).status_code == 404


def test_cycle_math():
    starts = main.period_starts([{"day": d, "flow": f} for d, f in [
        ("2026-01-01", "medium"), ("2026-01-02", "light"), ("2026-01-15", None), ("2026-01-29", "medium"),
        ("2026-02-25", "spotting"), ("2026-02-26", "light")]])
    assert starts == ["2026-01-01", "2026-01-29", "2026-02-26"], starts
    nxt, _ = main.compute_prediction(starts, date(2026, 3, 1))
    assert nxt == "2026-03-26", nxt      # Feb 26 + median(28, 28)


def test_state_uses_the_phones_date():
    with client() as c:
        c.post("/api/log", json={"date": iso(-3), "flow": "heavy"}, headers=H)
        s = c.get(f"/api/state?today={iso(0)}").json()
        assert s["today"]["today"] == iso(0) and s["today"]["cycleDay"] == 4
        s = c.get(f"/api/state?today={iso(1)}").json()
        assert s["today"]["cycleDay"] == 5, "a phone a timezone ahead gets its own today"
        assert c.get(f"/api/state?today={iso(9)}").json()["today"]["today"] == iso(0), "nonsense dates are ignored"


def test_passcode_flow():
    with client() as c:
        assert c.post("/api/settings/passcode", json={"new": "12"}, headers=H).status_code == 400
        r = c.post("/api/settings/passcode", json={"new": "secret-1"}, headers=H)
        assert r.status_code == 200 and main.COOKIE in r.cookies, "the device that sets it stays signed in"
        assert c.get("/api/state").status_code == 200
    with client() as other:
        assert other.get("/api/state").status_code == 401
        assert other.get("/api/export").status_code == 401
        assert other.get("/api/auth").json()["required"] is True
        assert other.post("/api/login", json={"passcode": "nope"}, headers=H).status_code == 401
        assert other.post("/api/login", json={"passcode": "secret-1"}, headers=H).status_code == 200
        assert other.get("/api/state").status_code == 200
        old = other.cookies.get(main.COOKIE)
        # changing the passcode signs every other device out
        assert other.post("/api/settings/passcode", json={"current": "wrong", "new": "secret-2"}, headers=H).status_code == 401
        assert other.post("/api/settings/passcode", json={"current": "secret-1", "new": "secret-2"}, headers=H).status_code == 200
    with client() as stale:
        stale.cookies.set(main.COOKIE, old)
        assert stale.get("/api/state").status_code == 401
        for _ in range(8):
            stale.post("/api/login", json={"passcode": "guess"}, headers=H)
        assert stale.post("/api/login", json={"passcode": "secret-2"}, headers=H).status_code == 429, "rate limited"
        main._fails.clear()
        assert stale.post("/api/login", json={"passcode": "secret-2"}, headers=H).status_code == 200
        assert stale.post("/api/settings/passcode", json={"current": "secret-2", "new": ""}, headers=H).json()["required"] is False
    with client() as anyone:
        assert anyone.get("/api/state").status_code == 200


def test_export_import_roundtrip():
    with client() as c:
        c.post("/api/log", json={"date": iso(-2), "mood": "good", "notes": "a, \"quoted\" note", "extras": {"pain": 2}}, headers=H)
        j = c.get("/api/export?format=json")
        assert j.status_code == 200 and "attachment" in j.headers["content-disposition"]
        data = j.json()
        assert data["app"] == "ironicles" and len(data["entries"]) >= 2
        csv = c.get("/api/export?format=csv").text
        assert csv.splitlines()[0] == "day,flow,symptoms,mood,pain,notes,created_at" and '"a, ""quoted"" note"' in csv
        r = c.post("/api/import", content=j.content, headers=H).json()
        assert r["added"] == 0 and r["skipped"] == len(data["entries"]), r
        data["entries"].append({"day": iso(-20), "flow": "light", "symptoms": ["acne"]})
        data["entries"].append({"day": "not-a-date"})
        import json
        r = c.post("/api/import", content=json.dumps(data), headers=H).json()
        assert (r["added"], r["invalid"]) == (1, 1), r
        assert c.post("/api/import", content=b"{}", headers=H).status_code == 400


if __name__ == "__main__":
    n = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); n += 1
            print("ok", name)
    print(f"{n} passed")
