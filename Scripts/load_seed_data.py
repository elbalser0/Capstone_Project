#!/usr/bin/env python3
"""
Assessment Helper - load the seed_data CSVs into PostgreSQL.

Only needed for a fresh or reset database. The team database is already
seeded, so everyone sharing it does NOT need to run this.

Setup (once):
    pip install "psycopg[binary]"

Usage:
    python load_seed_data.py                     # DATABASE_URL from env, else ../backend/.env
    python load_seed_data.py --url "postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require"
    python load_seed_data.py --dir path/to/csvs  # default: ./seed_data next to this script

How it works:
    * Refuses to run if any of the 7 tables already has rows, so the shared
      database never gets duplicate or mixed seed data.
    * Loads the tables in foreign-key order inside ONE transaction, so a
      failure leaves the database unchanged.
    * Uses each CSV's header row as the column list; empty cells become NULL.
    * Afterwards, moves the identity sequences past the seeded IDs so rows the
      app inserts don't collide. If your role isn't allowed to do that, the
      data is still committed and the SQL for the table owner is printed.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys

try:
    import psycopg
    from psycopg import sql
except ImportError:
    sys.exit('psycopg is not installed. Run:  pip install "psycopg[binary]"')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_ENV = os.path.join(SCRIPT_DIR, "..", "backend", ".env")

# Foreign-key-safe load order, with the integer id column whose sequence to reset.
LOAD_ORDER = [
    ("department", "dept_id"),
    ("term", "term_id"),
    ("professor", None),       # PK is netid (text): no sequence
    ("ac_member", None),
    ("course", "course_id"),
    ("section", "section_id"),
    ("meeting_time", None),
]


def url_from_env_file(path: str) -> str | None:
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            m = re.match(r"\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)", line)
            if m:
                return m.group(1).strip().strip('"').strip("'") or None
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description="Load seed CSVs into PostgreSQL.")
    ap.add_argument("--url", help="Postgres connection string "
                                  "(default: $DATABASE_URL, then backend/.env)")
    ap.add_argument("--dir", default=os.path.join(SCRIPT_DIR, "seed_data"),
                    help="folder containing the CSVs (default: seed_data next to this script)")
    ap.add_argument("--schema", default="public", help="schema the tables live in (default public)")
    args = ap.parse_args()

    url = args.url or os.environ.get("DATABASE_URL") or url_from_env_file(BACKEND_ENV)
    if not url:
        sys.exit("No connection string. Pass --url, set DATABASE_URL, or add it to backend/.env.")

    missing = [t for t, _ in LOAD_ORDER if not os.path.exists(os.path.join(args.dir, f"{t}.csv"))]
    if missing:
        sys.exit(f"Missing CSV files in {args.dir}: {', '.join(m + '.csv' for m in missing)}")

    try:
        conn = psycopg.connect(url, connect_timeout=10)
    except psycopg.Error as e:
        # Don't echo the URL (it contains the password).
        sys.exit(f"Could not connect to the database ({type(e).__name__}).")

    pending_resets = []
    with conn, conn.cursor() as cur:  # commits on success, rolls back on error
        nonempty = []
        for table, _ in LOAD_ORDER:
            cur.execute(sql.SQL("SELECT EXISTS (SELECT 1 FROM {})").format(
                sql.Identifier(args.schema, table)))
            if cur.fetchone()[0]:
                nonempty.append(table)
        if nonempty:
            sys.exit(f"Already seeded - these tables have rows: {', '.join(nonempty)}.\n"
                     "Nothing was loaded. (The shared database only needs seeding once.)")

        for table, _ in LOAD_ORDER:
            path = os.path.join(args.dir, f"{table}.csv")
            with open(path, newline="", encoding="utf-8") as f:
                header = next(csv.reader(f))
                f.seek(0)
                stmt = sql.SQL("COPY {} ({}) FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')").format(
                    sql.Identifier(args.schema, table),
                    sql.SQL(", ").join(sql.Identifier(c) for c in header))
                try:
                    with cur.copy(stmt) as copy:
                        copy.write(f.read())
                except psycopg.Error as e:
                    sys.exit(f"\nFailed loading {table}.csv - nothing was saved.\n"
                             f"{e.diag.message_primary}\n{e.diag.context or ''}")
            print(f"  {table:<14} {cur.rowcount:>5} rows")

        for table, id_col in LOAD_ORDER:
            if not id_col:
                continue
            cur.execute("SELECT pg_get_serial_sequence(%s, %s)", (f"{args.schema}.{table}", id_col))
            seq = cur.fetchone()[0]
            if not seq:
                continue
            cur.execute(sql.SQL("SELECT MAX({}) FROM {}").format(
                sql.Identifier(id_col), sql.Identifier(args.schema, table)))
            next_id = (cur.fetchone()[0] or 0) + 1
            try:
                with conn.transaction():  # savepoint: a refusal here keeps the loaded data
                    cur.execute("SELECT setval(%s, %s, false)", (seq, next_id))
            except psycopg.errors.InsufficientPrivilege:
                pending_resets.append((table, id_col, next_id))

    print("Done - all tables loaded and committed.")
    if pending_resets:
        print("\nYour role can't reset the ID sequences. Ask the table owner to run:")
        for table, id_col, next_id in pending_resets:
            print(f"  ALTER TABLE {table} ALTER COLUMN {id_col} RESTART WITH {next_id};")
        print("Until then, the app's inserts into these tables will fail with duplicate keys.")


if __name__ == "__main__":
    main()
