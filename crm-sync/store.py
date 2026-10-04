"""SQLite store: every pulled record with its history of changes between syncs.

All entities live in one table, _records(entity, key, data JSON, ...). For each
entity there is also a view with the same name whose columns are the record's
fields flattened ("client.city"), so `SELECT * FROM orders` reads like a table.
"""

import csv
import hashlib
import json
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS _runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT,
    summary TEXT
);
CREATE TABLE IF NOT EXISTS _records (
    entity TEXT NOT NULL,
    key TEXT NOT NULL,
    data TEXT NOT NULL,
    hash TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (entity, key)
);
CREATE TABLE IF NOT EXISTS _history (
    entity TEXT NOT NULL,
    key TEXT NOT NULL,
    run_id INTEGER NOT NULL,
    change TEXT NOT NULL,
    at TEXT NOT NULL,
    data TEXT
);
CREATE INDEX IF NOT EXISTS _history_entity_key ON _history (entity, key);
"""

FLATTEN_DEPTH = 3


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def record_key(record, key_field):
    fields = key_field if isinstance(key_field, list) else [key_field] if key_field else []
    values = [record.get(f) for f in fields] if isinstance(record, dict) else []
    if values and all(v is not None for v in values):
        return "|".join(str(v) for v in values)
    # No usable id: the content itself is the identity.
    return "sha:" + hashlib.sha256(canonical(record).encode()).hexdigest()[:24]


def flat_paths(record, prefix=(), depth=0):
    """Paths of scalar (or list) leaves, nested dicts expanded up to FLATTEN_DEPTH."""
    for name, value in record.items():
        path = (*prefix, name)
        if isinstance(value, dict) and value and depth < FLATTEN_DEPTH:
            yield from flat_paths(value, path, depth + 1)
        else:
            yield path


def quote_ident(name):
    return '"' + str(name).replace('"', '""') + '"'


def json_path(path):
    return "$" + "".join("." + quote_ident(p) for p in path)


class Store:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.executescript(SCHEMA)

    def close(self):
        self.conn.close()

    # --- runs ------------------------------------------------------------

    def start_run(self):
        cur = self.conn.execute("INSERT INTO _runs (started_at, status) VALUES (?, 'running')", (utc_now(),))
        self.conn.commit()
        return cur.lastrowid

    def finish_run(self, run_id, status, summary):
        self.conn.execute(
            "UPDATE _runs SET finished_at = ?, status = ?, summary = ? WHERE id = ?",
            (utc_now(), status, canonical(summary), run_id),
        )
        self.conn.commit()

    # --- records ---------------------------------------------------------

    def apply(self, run_id, entity, records, key_field="id", complete=True, ignore=()):
        """Upsert one entity's pulled records; returns counts of new/updated/deleted/...

        complete=True means `records` is everything the CRM has for this entity,
        so ids that were stored before and are missing now get marked deleted.
        Fields in `ignore` don't count as a change (e.g. a computed "days ago").
        """
        ts = utc_now()
        existing = {
            key: (digest, deleted_at)
            for key, digest, deleted_at in self.conn.execute(
                "SELECT key, hash, deleted_at FROM _records WHERE entity = ?", (entity,)
            )
        }
        counts = Counter(pulled=0)
        seen = set()
        with self.conn:
            for record in records:
                key = record_key(record, key_field)
                if key in seen:
                    continue
                seen.add(key)
                counts["pulled"] += 1
                data = json.dumps(record, ensure_ascii=False, separators=(",", ":"))  # keeps the CRM's field order
                compared = {k: v for k, v in record.items() if k not in ignore} if isinstance(record, dict) else record
                digest = hashlib.sha256(canonical(compared).encode()).hexdigest()
                old = existing.get(key)
                if old is None:
                    change = "new"
                    self.conn.execute(
                        "INSERT INTO _records VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
                        (entity, key, data, digest, ts, ts, ts),
                    )
                elif old[1] is not None or old[0] != digest:
                    change = "restored" if old[1] is not None else "updated"
                    self.conn.execute(
                        "UPDATE _records SET data = ?, hash = ?, last_seen = ?, changed_at = ?, deleted_at = NULL"
                        " WHERE entity = ? AND key = ?",
                        (data, digest, ts, ts, entity, key),
                    )
                else:
                    self.conn.execute(
                        "UPDATE _records SET data = ?, last_seen = ? WHERE entity = ? AND key = ?",
                        (data, ts, entity, key),
                    )
                    continue
                counts[change] += 1
                self.conn.execute(
                    "INSERT INTO _history VALUES (?, ?, ?, ?, ?, ?)", (entity, key, run_id, change, ts, data)
                )
            if complete:
                for key, (_, deleted_at) in existing.items():
                    if key not in seen and deleted_at is None:
                        counts["deleted"] += 1
                        self.conn.execute(
                            "UPDATE _records SET deleted_at = ? WHERE entity = ? AND key = ?", (ts, entity, key)
                        )
                        self.conn.execute(
                            "INSERT INTO _history VALUES (?, ?, ?, 'deleted', ?, NULL)", (entity, key, run_id, ts)
                        )
        self.refresh_view(entity)
        return dict(counts)

    def records(self, entity):
        rows = self.conn.execute(
            "SELECT data FROM _records WHERE entity = ? AND deleted_at IS NULL ORDER BY key", (entity,)
        )
        return [json.loads(data) for (data,) in rows]

    def changed_keys(self, entity, run_id):
        rows = self.conn.execute(
            "SELECT DISTINCT key FROM _history WHERE entity = ? AND run_id = ? AND change != 'deleted'",
            (entity, run_id),
        )
        return {key for (key,) in rows}

    def entities(self):
        return [e for (e,) in self.conn.execute("SELECT DISTINCT entity FROM _records ORDER BY entity")]

    # --- flattened views and exports ---------------------------------------

    def refresh_view(self, entity):
        paths = {}
        for (data,) in self.conn.execute("SELECT data FROM _records WHERE entity = ?", (entity,)):
            record = json.loads(data)
            for path in flat_paths(record) if isinstance(record, dict) else ():
                paths.setdefault(path, None)
        columns = [f"key AS {quote_ident('_key')}"]
        names = {"_key"}
        for path in paths:
            name = ".".join(map(str, path))
            if name in names:
                continue
            names.add(name)
            columns.append(f"json_extract(data, {sql_string(json_path(path))}) AS {quote_ident(name)}")
        if len(columns) == 1:
            columns.append("data")
        columns += ["first_seen AS _first_seen", "changed_at AS _changed_at"]
        view = quote_ident(entity)
        with self.conn:
            self.conn.execute(f"DROP VIEW IF EXISTS {view}")
            self.conn.execute(
                f"CREATE VIEW {view} AS SELECT {', '.join(columns)} FROM _records"
                f" WHERE entity = {sql_string(entity)} AND deleted_at IS NULL"
            )

    def export_csv(self, out_dir):
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        written = {}
        for entity in self.entities():
            cur = self.conn.execute(f"SELECT * FROM {quote_ident(entity)}")
            header = [d[0] for d in cur.description]
            path = out_dir / f"{entity}.csv"
            # utf-8-sig so Excel opens Cyrillic text correctly
            with open(path, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.writer(f)
                writer.writerow(header)
                rows = cur.fetchall()
                writer.writerows(rows)
            written[entity] = len(rows)
        return written


def sql_string(value):
    return "'" + str(value).replace("'", "''") + "'"
