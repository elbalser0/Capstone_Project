#!/usr/bin/env python3
"""
Assessment Helper - fictional seed-data generator.

Generates CSV files of fictional faculty data that match the team's PostgreSQL
schema, for CSV import. Standard library only (Python 3.9+).

Output files, in FK-safe load order (one per table):
    1. department.csv     dept_id, dept_name
    2. term.csv           term_id, season, year, start_date, end_date
    3. professor.csv      netid, first_name, last_name, email, rank, dept_id,
                          eval_interval_years, baseline_last_eval_term, is_active
    4. ac_member.csv      netid, is_active
    5. course.csv         course_id, dept_id, course_num, title, course_level
    6. section.csv        section_id, course_id, term_id, section_num, instructor_id, class_mode
    7. meeting_time.csv   section_id, day_of_week, start_time, end_time, room

Evaluation status follows the process doc by calendar year: due year = year of
baseline_last_eval_term + eval_interval_years; overdue once that year has passed.
A NULL baseline (new hire or never evaluated) means due now.

Teaching history is not a separate table: sections in past terms ARE the
history (default: 4 past terms = 2 years, plus the current and next term).

Departments are academic departments, not course prefixes. Several prefixes can
share one department (CS and SE courses both belong to Computer Science), so
observer matching should compare dept_id + course_level, never the prefix.
Because the course table has no prefix column, course_num is kept unique
within each department.

Usage:
    python generate_faculty_data.py                       # 100 professors, Fall 2026 current
    python generate_faculty_data.py --faculty 60 --seed 7 --out seed_data
    python generate_faculty_data.py --current-term "Spring 2027"

The same --seed always produces identical files. Names are random
combinations, emails use the reserved example.edu domain, and NetIDs are
random, so no real person is represented.

Loading into PostgreSQL:
    * dept_id, term_id, course_id and section_id are explicit integers from 1.
      If those columns are SERIAL/IDENTITY, reset each sequence after import:
        SELECT setval(pg_get_serial_sequence('section','section_id'),
                      (SELECT MAX(section_id) FROM section));
    * Empty cells are NULLs:  \\copy professor FROM 'professor.csv' WITH (FORMAT csv, HEADER, NULL '')
    * Edit the column lists in TABLES below if a column name differs.
"""

from __future__ import annotations

import argparse
import csv
import os
import random
from collections import defaultdict
from datetime import date

# --------------------------------------------------------------------------- #
# Table columns (edit to match the schema exactly)
# --------------------------------------------------------------------------- #
TABLES = {
    "department":   ["dept_id", "dept_name"],
    "term":         ["term_id", "season", "year", "start_date", "end_date"],
    "professor":    ["netid", "first_name", "last_name", "email", "rank", "dept_id",
                     "eval_interval_years", "baseline_last_eval_term", "is_active"],
    "ac_member":    ["netid", "is_active"],
    "course":       ["course_id", "dept_id", "course_num", "title", "course_level"],
    "section":      ["section_id", "course_id", "term_id", "section_num", "instructor_id",
                     "class_mode"],
    "meeting_time": ["section_id", "day_of_week", "start_time", "end_time", "room"],
}

# --------------------------------------------------------------------------- #
# Reference data
# --------------------------------------------------------------------------- #
# (dept_name, share of faculty, buildings, courses). Prefixes in the comments
# are for readability only; they are not stored. Physics is deliberately small
# so some sign-ups get too few observers (exercises the AC alert).
DEPARTMENTS = [
    ("Computer Science", 0.40, ["ENG", "ECN"], [
        # CS prefix
        (1336, "Programming Fundamentals"), (1337, "Computer Science I"),
        (2305, "Discrete Mathematics for Computing"), (2336, "Computer Science II"),
        (2340, "Computer Architecture"), (3345, "Data Structures and Algorithmic Analysis"),
        (3377, "Systems Programming in UNIX"), (4337, "Programming Language Paradigms"),
        (4347, "Database Systems"), (4348, "Operating Systems Concepts"),
        (4375, "Introduction to Machine Learning"), (4485, "Computer Science Project"),
        (6363, "Design and Analysis of Computer Algorithms"), (6375, "Machine Learning"),
        (6320, "Natural Language Processing"),
        # SE prefix (same department)
        (3354, "Software Engineering"), (4351, "Requirements Engineering"),
        (4352, "Software Architecture and Design"), (4367, "Software Testing and Quality Assurance"),
        (4381, "Software Project Planning and Management"), (6354, "Advanced Software Engineering"),
    ]),
    ("Electrical and Computer Engineering", 0.25, ["ENG", "ECN"], [
        # EE prefix
        (1202, "Introduction to Electrical Engineering"), (2301, "Electric Circuit Analysis"),
        (2310, "Introduction to Digital Systems"), (3302, "Signals and Systems"),
        (3311, "Electronic Circuits"), (4325, "Control Systems"), (4370, "Embedded Systems"),
        (6360, "Digital Signal Processing"), (6325, "VLSI Design"),
        # CE prefix (same department)
        (3320, "Digital Circuit Design"), (4304, "Computer Architecture Design"),
        (6304, "Advanced Computer Architecture"),
    ]),
    ("Mathematical Sciences", 0.22, ["MTH", "SCI"], [
        # MATH prefix
        (1314, "College Algebra"), (2413, "Differential Calculus"), (2414, "Integral Calculus"),
        (2418, "Linear Algebra"), (2419, "Calculus III"), (3310, "Theoretical Concepts of Calculus"),
        (3351, "Advanced Calculus"), (4301, "Mathematical Analysis"), (4334, "Numerical Analysis"),
        (6301, "Real Analysis"), (6313, "Numerical Methods"),
        # STAT prefix (same department)
        (3341, "Probability and Statistics"), (4382, "Applied Statistics"),
    ]),
    ("Physics", 0.13, ["SCI"], [
        (1301, "College Physics I"), (1302, "College Physics II"), (2325, "Mechanics"),
        (2326, "Electromagnetism and Waves"), (3311, "Classical Mechanics"),
        (3330, "Thermodynamics"), (4301, "Quantum Mechanics"), (4328, "Electromagnetic Theory"),
        (6300, "Statistical Physics"),
    ]),
]

FIRST_NAMES = [
    "Aaron", "Abigail", "Adebayo", "Aisha", "Alejandro", "Amara", "Ananya", "Andrei",
    "Beatriz", "Benjamin", "Caroline", "Chen", "Daniela", "David", "Deepak", "Elena",
    "Emeka", "Fatima", "Felipe", "Gabriel", "Grace", "Hana", "Hiroshi", "Ibrahim",
    "Ingrid", "Isabel", "Jamal", "Javier", "Jin", "Julia", "Kavya", "Kenji", "Laila",
    "Leon", "Lucia", "Malik", "Maria", "Mateo", "Mei", "Michael", "Nadia", "Nikhil",
    "Olivia", "Omar", "Priyanka", "Rafael", "Rebecca", "Rohan", "Samira", "Sergei",
    "Sofia", "Tariq", "Thomas", "Uma", "Victor", "Wei", "Yasmin", "Yusuf", "Zara", "Zoe",
]
LAST_NAMES = [
    "Abernathy", "Achebe", "Alvarez", "Anand", "Bergstrom", "Bhattacharya", "Castillo",
    "Chandrasekar", "Delacroix", "Dimitrov", "Eriksen", "Fairbanks", "Fernandes", "Gallagher",
    "Haddad", "Hollister", "Ivanova", "Jafari", "Kowalczyk", "Krishnan", "Lindqvist",
    "Mbeki", "Montoya", "Nakamura", "Novak", "Okonkwo", "Oyelaran", "Petrakis", "Quintero",
    "Ramaswamy", "Rosenthal", "Sadeghi", "Takahashi", "Thornbury", "Underhill", "Vasquez",
    "Velasquez", "Whitcombe", "Yamamoto", "Zielinski", "Brennan", "Calloway", "Desai",
    "Esposito", "Faulkner", "Greer", "Huang", "Iyer", "Juarez", "Kaur", "Lombardi",
]

RANKS = ["assistant", "associate", "full"]
RANK_WEIGHTS = [0.35, 0.33, 0.32]
EVAL_INTERVAL = {"assistant": 1, "associate": 2, "full": 2}
TEACHING_LOAD = {"assistant": (2, 3), "associate": (1, 3), "full": (1, 2)}

# Meeting patterns: (days, slots, weight for undergrad, weight for grad). 24h times.
SLOTS_75 = [("08:30", "09:45"), ("10:00", "11:15"), ("11:30", "12:45"), ("13:00", "14:15"),
            ("14:30", "15:45"), ("16:00", "17:15"), ("17:30", "18:45"), ("19:00", "20:15")]
SLOTS_50 = [("09:00", "09:50"), ("10:00", "10:50"), ("11:00", "11:50"),
            ("12:00", "12:50"), ("13:00", "13:50")]
SLOTS_EVENING = [("19:00", "21:45")]
PATTERNS = [
    (["monday", "wednesday"], SLOTS_75, 40, 30),
    (["tuesday", "thursday"], SLOTS_75, 40, 30),
    (["monday", "wednesday", "friday"], SLOTS_50, 15, 0),
    (["monday"], SLOTS_EVENING, 1, 10),
    (["tuesday"], SLOTS_EVENING, 1, 10),
    (["wednesday"], SLOTS_EVENING, 1, 10),
    (["thursday"], SLOTS_EVENING, 2, 10),
]

ONLINE_RATE = 0.05           # sections with no meeting_time rows
NEW_HIRE_RATE = 0.08         # assistants whose first term is the current term
NEVER_EVALUATED_RATE = 0.10  # established professors with NULL baseline_last_eval_term
# Target mix of evaluation status in the current term, per rank (see eval_status).
STATUS_WEIGHTS = {
    "assistant": {"overdue": 0.10, "due": 0.45, "not due": 0.45},
    "associate": {"overdue": 0.12, "due": 0.38, "not due": 0.50},
    "full":      {"overdue": 0.12, "due": 0.38, "not due": 0.50},
}
INACTIVE_RATE = 0.04         # professors on sabbatical/left: past sections only
AC_MEMBER_COUNT = 5          # one of them is seeded as an inactive AC member


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def to_minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def overlaps(a, b) -> bool:
    return to_minutes(a[0]) < to_minutes(b[1]) and to_minutes(b[0]) < to_minutes(a[1])


def eval_status(last_eval_year, interval: int, current_year: int) -> str:
    """Process-doc rule, by calendar year. Last eval Spring 2025 + 2-year interval
    -> due in 2027 (Spring or Fall), overdue from 2028. None (never evaluated) -> due now."""
    if last_eval_year is None:
        return "due"
    due_year = int(last_eval_year) + interval
    if due_year > current_year:
        return "not due"
    return "due" if due_year == current_year else "overdue"


def parse_term(name: str) -> tuple[str, int]:
    season, year = name.strip().split()
    season = season.lower()
    if season not in ("spring", "fall"):
        raise ValueError(f"Season must be Spring or Fall: '{name}'")
    return season, int(year)


def build_terms(current: tuple[str, int], history: int, future: int, eval_years: int = 5):
    seq = [(y, s) for y in range(current[1] - 12, current[1] + 5) for s in ("spring", "fall")]
    idx = seq.index((current[1], current[0]))
    back = max(history, eval_years * 2)  # older terms so baseline evaluations can reference them
    terms = []
    for i, (year, season) in enumerate(seq[idx - back: idx + future + 1], start=1):
        start, end = ((date(year, 1, 12), date(year, 5, 8)) if season == "spring"
                      else (date(year, 8, 24), date(year, 12, 11)))
        terms.append({"term_id": i, "season": season, "year": year,
                      "start_date": start.isoformat(), "end_date": end.isoformat()})
    return terms, back  # index of current term within the list == back


def write_csv(out: str, table: str, rows: list[dict]) -> None:
    cols = TABLES[table]
    with open(os.path.join(out, f"{table}.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: ("" if r.get(c) is None else r[c]) for c in cols})


# --------------------------------------------------------------------------- #
# Generators
# --------------------------------------------------------------------------- #
def gen_departments_and_courses():
    departments, courses, cid = [], [], 1
    for dept_id, (name, _share, _bldgs, catalog) in enumerate(DEPARTMENTS, start=1):
        nums = [n for n, _ in catalog]
        assert len(nums) == len(set(nums)), f"duplicate course_num in {name}"
        departments.append({"dept_id": dept_id, "dept_name": name})
        for num, title in sorted(catalog):
            courses.append({"course_id": cid, "dept_id": dept_id, "course_num": num,
                            "title": title, "course_level": (num // 1000) * 1000})
            cid += 1
    return departments, courses


def gen_professors(rng: random.Random, n: int, departments, terms, cur_idx: int):
    shares = [d[1] for d in DEPARTMENTS]
    counts = [max(3, round(n * s)) for s in shares]
    counts[0] += n - sum(counts)  # rounding remainder goes to the largest department

    used_names, used_netids, profs = set(), set(), []
    for dept, count in zip(departments, counts):
        for _ in range(count):
            while True:
                first, last = rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES)
                if (first, last) not in used_names:
                    used_names.add((first, last))
                    break
            while True:  # UTD-style NetID: three letters + six digits
                netid = (first[0] + rng.choice("abcdefghijklmnoprstw") + last[0]).lower() \
                        + f"{rng.randint(0, 999999):06d}"
                if netid not in used_netids:
                    used_netids.add(netid)
                    break
            rank = rng.choices(RANKS, RANK_WEIGHTS)[0]
            # First term this professor teaches (index into terms).
            if rank == "assistant" and rng.random() < NEW_HIRE_RATE:
                first_term = cur_idx
            elif rank == "assistant":
                first_term = rng.randint(max(0, cur_idx - 10), cur_idx - 1)
            else:
                first_term = 0
            # Baseline last evaluation: pick a target status (overdue / due / not due
            # in the current term), then a past term on or after their first term
            # that produces it. NULL = never evaluated, which the app treats as due now.
            past = list(range(first_term, cur_idx))
            baseline = None
            if past and rng.random() > NEVER_EVALUATED_RATE:
                by_status = defaultdict(list)
                for i in past:
                    by_status[eval_status(terms[i]["year"], EVAL_INTERVAL[rank],
                                          terms[cur_idx]["year"])].append(i)
                weights = STATUS_WEIGHTS[rank]
                options = [s for s in weights if by_status[s]]
                status = rng.choices(options, [weights[s] for s in options])[0]
                baseline = terms[rng.choice(by_status[status])]["term_id"]

            profs.append({
                "netid": netid, "first_name": first, "last_name": last,
                "email": f"{first.lower()}.{last.lower()}@example.edu",
                "rank": rank, "dept_id": dept["dept_id"],
                "eval_interval_years": EVAL_INTERVAL[rank],
                "baseline_last_eval_term": baseline,
                "is_active": rng.random() > INACTIVE_RATE or first_term == cur_idx,
                "_first_term": first_term,
            })

    senior = [p for p in profs if p["rank"] != "assistant" and p["is_active"]]
    ac = [{"netid": p["netid"], "is_active": True}
          for p in rng.sample(senior, min(AC_MEMBER_COUNT, len(senior)))]
    if ac:
        ac[-1]["is_active"] = False  # a former AC member
    return profs, ac


def gen_sections(rng: random.Random, profs, courses, terms, cur_idx: int, history: int):
    by_dept = defaultdict(list)
    for c in courses:
        by_dept[c["dept_id"]].append(c)
    buildings = {i: d[2] for i, d in enumerate(DEPARTMENTS, start=1)}

    # Stable repertoire: 2-4 courses at and next to a "home" level.
    repertoire = {}
    for p in profs:
        pool = by_dept[p["dept_id"]]
        levels = sorted({c["course_level"] for c in pool})
        if p["rank"] == "assistant":
            weights = [3 if l <= 2000 else 2 if l <= 4000 else 1 for l in levels]
        else:
            weights = [1 if l <= 2000 else 2 if l <= 4000 else 3 for l in levels]
        i = levels.index(rng.choices(levels, weights)[0])
        near = set(levels[max(0, i - 1): i + 2])
        cands = [c for c in pool if c["course_level"] in near]
        repertoire[p["netid"]] = rng.sample(cands, min(len(cands), rng.randint(2, 4)))

    sections, meetings, sid = [], [], 1
    for t_idx in range(max(0, cur_idx - history), len(terms)):
        term = terms[t_idx]
        busy_prof, busy_room = defaultdict(list), defaultdict(list)
        counter = defaultdict(int)
        for p in profs:
            if t_idx < p["_first_term"]:
                continue
            if not p["is_active"] and t_idx >= cur_idx:
                continue  # inactive professors have no current/future sections
            for _ in range(rng.randint(*TEACHING_LOAD[p["rank"]])):
                course = rng.choice(repertoire[p["netid"]])
                grad = course["course_level"] >= 5000
                online = rng.random() < ONLINE_RATE
                meeting = None
                if not online:
                    for _try in range(40):
                        days, slots, _, _ = rng.choices(
                            PATTERNS, [x[3] if grad else x[2] for x in PATTERNS])[0]
                        slot = rng.choice(slots)
                        if any(overlaps(slot, b) for d in days for b in busy_prof[(p["netid"], d)]):
                            continue
                        for _r in range(10):
                            room = (f"{rng.choice(buildings[p['dept_id']])} "
                                    f"{rng.randint(1, 4)}.{rng.randint(100, 999)}")
                            if not any(overlaps(slot, b) for d in days for b in busy_room[(room, d)]):
                                meeting = (days, slot, room)
                                break
                        if meeting:
                            break
                    if meeting is None:
                        continue  # no conflict-free slot found; skip this section
                    for d in meeting[0]:
                        busy_prof[(p["netid"], d)].append(meeting[1])
                        busy_room[(meeting[2], d)].append(meeting[1])

                # Separate numbering per kind: day 001, 002...; evening 501, 502...; online 0W1...
                if online:
                    kind = "online"
                elif to_minutes(meeting[1][0]) >= to_minutes("17:30"):
                    kind = "evening"
                else:
                    kind = "day"
                counter[(course["course_id"], kind)] += 1
                k = counter[(course["course_id"], kind)]
                num = {"online": f"0W{k}", "evening": f"5{k:02d}", "day": f"{k:03d}"}[kind]
                sections.append({"section_id": sid, "course_id": course["course_id"],
                                 "term_id": term["term_id"], "section_num": num,
                                 "instructor_id": p["netid"],
                                 "class_mode": "online" if online else "in-person"})
                if meeting:
                    for d in meeting[0]:
                        meetings.append({"section_id": sid, "day_of_week": d,
                                         "start_time": meeting[1][0], "end_time": meeting[1][1],
                                         "room": meeting[2]})
                sid += 1
    return sections, meetings


# --------------------------------------------------------------------------- #
def print_summary(out, data, terms, cur_idx):
    print(f"Wrote CSVs to {os.path.abspath(out)}")
    for table in TABLES:
        print(f"  {table + '.csv':<18} {len(data[table]):>5} rows")

    profs = data["professor"]
    by_rank = defaultdict(int)
    for p in profs:
        by_rank[p["rank"]] += 1
    print(f"\nProfessors: {dict(by_rank)}; inactive: {sum(not p['is_active'] for p in profs)}; "
          f"no baseline eval: {sum(p['baseline_last_eval_term'] is None for p in profs)}")

    cur = terms[cur_idx]
    year_of = {t["term_id"]: t["year"] for t in terms}
    status = defaultdict(lambda: defaultdict(int))
    for p in profs:
        if p["is_active"]:
            b = p["baseline_last_eval_term"]
            s = eval_status(year_of[b] if b else None, p["eval_interval_years"], cur["year"])
            status[p["rank"]][s] += 1
    print(f"\nEvaluation status of active professors in {cur['season'].title()} {cur['year']} "
          "(never evaluated counts as due):")
    for rank in RANKS:
        row = status[rank]
        print(f"  {rank:<10} due {row['due']:>3}   overdue {row['overdue']:>3}   not due {row['not due']:>3}")
    tot = {s: sum(status[r][s] for r in RANKS) for s in ("due", "overdue", "not due")}
    print(f"  {'total':<10} due {tot['due']:>3}   overdue {tot['overdue']:>3}   not due {tot['not due']:>3}")
    dept_name = {d["dept_id"]: d["dept_name"] for d in data["department"]}
    course = {c["course_id"]: c for c in data["course"]}
    pools = defaultdict(set)
    for s in data["section"]:
        if s["term_id"] == cur["term_id"]:
            c = course[s["course_id"]]
            pools[(dept_name[c["dept_id"]], c["course_level"])].add(s["instructor_id"])
    print(f"\nObserver pools in {cur['season'].title()} {cur['year']} "
          "(distinct instructors per dept + level; 6+ = observee plus 5 observers):")
    for (dept, lvl), who in sorted(pools.items()):
        flag = "" if len(who) >= 6 else "   <- too few, triggers alert"
        print(f"  {dept:<38} {lvl}: {len(who):>2}{flag}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate fictional faculty seed data as CSV files.")
    ap.add_argument("--faculty", type=int, default=100, help="number of professors (default 100)")
    ap.add_argument("--seed", type=int, default=42, help="random seed (default 42)")
    ap.add_argument("--out", default="seed_data", help="output folder (default ./seed_data)")
    ap.add_argument("--current-term", default="Fall 2026", help='e.g. "Fall 2026"')
    ap.add_argument("--history-terms", type=int, default=4,
                    help="past terms of sections before the current term (default 4 = 2 years)")
    ap.add_argument("--future-terms", type=int, default=1,
                    help="upcoming terms with sections (default 1)")
    args = ap.parse_args()
    if args.faculty < 20:
        ap.error("--faculty must be at least 20")

    rng = random.Random(args.seed)
    terms, cur_idx = build_terms(parse_term(args.current_term), args.history_terms, args.future_terms)
    departments, courses = gen_departments_and_courses()
    profs, ac = gen_professors(rng, args.faculty, departments, terms, cur_idx)
    sections, meetings = gen_sections(rng, profs, courses, terms, cur_idx, args.history_terms)

    data = {"department": departments, "term": terms, "professor": profs, "ac_member": ac,
            "course": courses, "section": sections, "meeting_time": meetings}
    os.makedirs(args.out, exist_ok=True)
    for table, rows in data.items():
        write_csv(args.out, table, rows)
    print_summary(args.out, data, terms, cur_idx)


if __name__ == "__main__":
    main()
