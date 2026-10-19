"""Benchmark a Picaluma library for the website's "Fast on real libraries" figures.

Reads library.db (read-only) and picaluma.log from the library folder and prints JSON with, per
watched folder: pictures, online-only (cloud) pictures, folders, bytes and listing time; plus
whole-library totals and search timings (same FTS query the app runs, median of 20 runs).

    python -I scripts/library-stats.py "%APPDATA%\\com.mokyiichek.picaluma"
"""
import json
import os
import re
import sqlite3
import statistics
import sys
import time

lib = sys.argv[1] if len(sys.argv) > 1 else os.path.expandvars(r"%APPDATA%\com.mokyiichek.picaluma")
db = sqlite3.connect(f"file:{os.path.join(lib, 'library.db')}?mode=ro", uri=True)
q = lambda sql, *a: db.execute(sql, a).fetchone()

listed = {}
log_path = os.path.join(lib, "picaluma.log")
if os.path.exists(log_path):
    for line in open(log_path, encoding="utf-8", errors="replace"):
        m = re.search(r"listed (.+?): (\d+) photos in ([\d.]+)(ms|s|µs)", line)
        if m:
            secs = float(m.group(3)) / {"ms": 1000, "s": 1, "µs": 1e6}[m.group(4)]
            listed[m.group(1)] = secs

roots = []
for (path,) in db.execute("SELECT path FROM roots WHERE excluded = 0 ORDER BY id"):
    pat = path.rstrip("\\/") + "%"
    n, cloud, size = q("SELECT COUNT(*), COALESCE(SUM(p.cloud), 0), COALESCE(SUM(p.size), 0) FROM photos p JOIN folders f ON f.id = p.folder_id WHERE f.path LIKE ?", pat)
    folders = q("SELECT COUNT(*) FROM folders WHERE path LIKE ?", pat)[0]
    roots.append({"path": path, "photos": n, "cloud": cloud, "folders": folders, "bytes": size, "list_seconds": listed.get(path)})


def bench(term):
    fts = " ".join(f'"{t}"*' for t in re.findall(r"\w+", term))
    runs = []
    hits = 0
    for _ in range(20):
        t = time.perf_counter()
        hits = len(db.execute("SELECT rowid FROM photos_fts WHERE photos_fts MATCH ?", (fts,)).fetchall())
        runs.append(time.perf_counter() - t)
    return {"query": term, "hits": hits, "seconds": round(statistics.median(runs), 4)}


total = q("SELECT COUNT(*), COALESCE(SUM(cloud), 0), COALESCE(SUM(size), 0), SUM(meta_done = 0) FROM photos")
print(json.dumps({
    "photos": total[0],
    "cloud": total[1],
    "bytes": total[2],
    "pending_index": total[3],
    "folders": q("SELECT COUNT(*) FROM folders")[0],
    "db_bytes": os.path.getsize(os.path.join(lib, "library.db")),
    "roots": roots,
    "search": [bench(t) for t in ["img", "dsc", "2019", "beach", "family trip", "iphone"]],
}, indent=2))
