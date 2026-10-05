"""Fill an EMPTY Ironicles database with realistic, made-up data — for trying the app out
and for screenshots. Never point this at a database that holds real data.

  python tools/seed_demo.py --db data/demo.db [--months 8] [--seed 7]
  IRONICLES_DB=data/demo.db uvicorn main:app --port 8889     # from backend/
"""
import argparse
import json
import math
import random
import sqlite3
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))


def moon(d: date) -> dict:
    ref = datetime(2000, 1, 6, 18, 14)
    age = ((datetime(d.year, d.month, d.day) - ref).total_seconds() / 86400.0) % 29.53058867
    names = ["new", "waxing_crescent", "first_quarter", "waxing_gibbous", "full", "waning_gibbous", "last_quarter", "waning_crescent"]
    cuts = [1.84566, 5.53699, 9.22831, 12.91963, 16.61096, 20.30228, 23.99361, 27.68493]
    i = next((n for n, c in enumerate(cuts) if age < c), 0)
    return {"ageDays": round(age, 2), "phase": names[i], "illumination": round(0.5 * (1 - math.cos(2 * math.pi * age / 29.53058867)), 3)}


NOTES = ["Long walk after work, felt good.", "Slept badly.", "Heating pad night.", "Big presentation went well!",
         "Skipped the gym, too tired.", "Yoga helped a lot.", "Craving everything salty.", "Headache by the afternoon."]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--db", required=True)
    ap.add_argument("--months", type=int, default=8)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--force", action="store_true", help="add to a database that already has entries")
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    Path(a.db).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(a.db)
    con.executescript("""CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL,
        flow TEXT, symptoms_json TEXT, mood TEXT, notes TEXT, extras_json TEXT, moon_json TEXT, created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_entries_day ON entries(day);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);""")
    if con.execute("SELECT count(*) FROM entries").fetchone()[0] and not a.force:
        sys.exit("refusing: that database already has entries (use a new file, or --force)")

    rows = []
    today = date.today()
    start = today - timedelta(days=30 * a.months)
    day = start
    while day <= today:
        length = rnd.choice([26, 27, 28, 28, 29, 30, 31])
        plen = rnd.choice([4, 5, 5, 6])
        flows = (["medium", "heavy", "medium", "light", "light", "spotting"])[:plen]
        for i in range(length):
            d = day + timedelta(days=i)
            if d > today:
                break
            cd = i + 1
            entry = None
            if cd <= plen:
                entry = {"flow": flows[cd - 1], "symptoms": rnd.sample(["cramps", "bloating", "fatigue", "backache"], k=2 if cd <= 2 else 1),
                         "mood": rnd.choice(["tired", "meh", "cozy", "sad"]), "pain": rnd.randint(4, 7) if cd <= 2 else None}
            elif length - cd < 5 and rnd.random() < .6:
                entry = {"flow": None, "symptoms": rnd.sample(["headache", "cravings", "sore breasts", "bloating", "mood swings"], k=2),
                         "mood": rnd.choice(["anxious", "angry", "meh", "tired"]), "pain": rnd.choice([None, 2, 3])}
            elif 12 <= cd <= 16 and rnd.random() < .35:
                entry = {"flow": None, "symptoms": [], "mood": rnd.choice(["radiant", "good"]), "pain": None}
            elif rnd.random() < .08:
                entry = {"flow": None, "symptoms": rnd.sample(["headache", "insomnia", "acne"], k=1), "mood": "meh", "pain": None}
            if entry:
                notes = rnd.choice(NOTES) if rnd.random() < .3 else None
                extras = {"pain": entry["pain"]} if entry["pain"] is not None else None
                rows.append((d.isoformat(), entry["flow"], json.dumps(entry["symptoms"]) if entry["symptoms"] else None,
                             entry["mood"], notes, json.dumps(extras) if extras else None, json.dumps(moon(d)),
                             datetime(d.year, d.month, d.day, 21, 0).isoformat()))
        day += timedelta(days=length)
    con.executemany("INSERT INTO entries(day, flow, symptoms_json, mood, notes, extras_json, moon_json, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows)
    con.commit()
    print(f"seeded {len(rows)} made-up entries into {a.db}")


if __name__ == "__main__":
    main()
