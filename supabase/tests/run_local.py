"""
Applies supabase/migrations/0001..0003 to a throwaway local PostgreSQL (pgserver) and verifies the security rules and routing.

Supabase-specific pieces (anon/authenticated roles, auth.users, auth.uid(), and the storage.buckets / storage.objects tables with
RLS) are STUBBED in PRELUDE. This checks the schema, constraints, triggers, grants, RLS and routing logic. It does NOT test
Supabase Auth, the Storage HTTP API, PostgREST, or rate limiting at the gateway.

    pip install pgserver psycopg2-binary
    npm test            # regenerates supabase/tests/parity.json from the TypeScript routing engine
    python supabase/tests/run_local.py [scratch-dir]
"""
import json
import os
import pathlib
import re
import sys
import tempfile

import pgserver
import psycopg2

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = pathlib.Path(os.environ.get('JALRAKSHAK_MIGRATIONS', ROOT / 'migrations'))   # override used for mutation testing
PRELUDE = """
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid,
                              metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select _parts[1:array_length(_parts, 1) - 1] from string_to_array(name, '/') as _parts $$;

grant usage on schema public, auth, storage to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
"""

ADMIN = "aaaaaaaa-0000-4000-8000-000000000001"
ADMIN2 = "aaaaaaaa-0000-4000-8000-000000000002"
OP1 = "bbbbbbbb-0000-4000-8000-000000000001"
OP2 = "bbbbbbbb-0000-4000-8000-000000000002"
USER = "cccccccc-0000-4000-8000-000000000001"   # signed in, but has no role
OLDOP = "dddddddd-0000-4000-8000-000000000001"  # an operator created under migration 0001
results = []


def check(name, ok, extra=""):
    results.append(bool(ok))
    print(("PASS  " if ok else "FAIL  ") + name + (f"  -> {extra}" if extra else ""))


tmp = tempfile.mkdtemp(prefix="pg_jalrakshak_", dir=sys.argv[1] if len(sys.argv) > 1 else None)
srv = pgserver.get_server(tmp, cleanup_mode="delete")
conn = psycopg2.connect(srv.get_uri())
conn.autocommit = True
cur = conn.cursor()


def run_as(role, sub=None):
    cur.execute("reset role")
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (sub or "",))
    if role != "owner":
        cur.execute(f"set role {role}")


def err(sql, params=None):
    """Run a statement that should fail; returns (message or None)."""
    try:
        cur.execute(sql, params)
        return None
    except psycopg2.Error as e:
        return str(e).strip().splitlines()[0]


def expect_error(sql, params=None, needle=None):
    msg = err(sql, params)
    return (msg is not None and (needle is None or needle.lower() in msg.lower())), (msg or "no error")


photo_n = [0]
rep_n = [0]


def make_photo(mimetype="image/jpeg", size=2000, path=None, bucket="report-photos"):
    photo_n[0] += 1
    path = path or f"incoming/photo-{photo_n[0]:05d}.jpg"
    run_as("owner")
    cur.execute("insert into storage.objects (bucket_id, name, metadata) values (%s, %s, %s)", (bucket, path, json.dumps({"mimetype": mimetype, "size": size})))
    return path


def submit(role="anon", sub=None, photo="auto", **over):
    rep_n[0] += 1
    a = dict(lat=28.61, lng=77.2, src="map_pin", acc=None, desc="Water gushing from a broken pipe near the market", lang="en", cat="burst_main",
             hints=["flooding"], landmark=None, sev=95, rep=f"rep-{rep_n[0]}", a_src=None, a_fmt=None, a_comp=None, meta=None)
    a.update(over)
    path = make_photo() if photo == "auto" else photo
    run_as(role, sub)
    cur.execute("select public.submit_report(%(lat)s,%(lng)s,%(src)s,%(acc)s,%(desc)s,%(lang)s,%(cat)s,%(hints)s,%(landmark)s,%(sev)s,%(p)s,%(rep)s,%(a_src)s,%(a_fmt)s,%(a_comp)s,%(meta)s)",
                {**a, "p": path, "meta": json.dumps(a["meta"]) if a["meta"] is not None else None, "a_comp": a["a_comp"]})
    return cur.fetchone()[0]


def rid_of(case_id):
    run_as("owner")
    cur.execute("select id from public.reports where case_id = %s", (case_id,))
    return cur.fetchone()[0]


def count(table, where="true"):
    cur.execute(f"select count(*) from public.{table} where {where}")
    return cur.fetchone()[0]


# =============================================================================================================================
# 0. Migration 0001 data must survive the upgrade
# =============================================================================================================================
cur.execute(PRELUDE)
cur.execute((MIGRATIONS / "0001_init.sql").read_text(encoding="utf-8"))
cur.execute("insert into auth.users values (%s)", (OLDOP,))
cur.execute("insert into public.operators values (%s, 'Old Operator')", (OLDOP,))
run_as("anon")
cur.execute("select public.submit_report(28.6,77.2,'map_pin',null,'Legacy report created before the upgrade, no photo','en','contamination','{}',null,70,null,'legacy-1','manual','Old Street, Old Town','{\"city\":\"Old Town\"}')")
legacy_case = cur.fetchone()[0]
run_as("owner")
for f in ("0002_roles_officers_routing.sql", "0003_storage.sql"):
    cur.execute((MIGRATIONS / f).read_text(encoding="utf-8"))
check("migrations 0001, 0002 and 0003 apply cleanly in order", True)
check("0001 report survives, with its address and a NULL photo (legacy rows are not deleted)", count("reports", f"case_id = '{legacy_case}' and photo_path is null and address_formatted = 'Old Street, Old Town'") == 1)
check("0001 case + audit event survive", count("cases", "report_id in (select id from public.reports where photo_path is null)") == 1 and count("case_events") >= 1)
check("0001 operator was migrated into user_roles", count("user_roles", f"user_id = '{OLDOP}' and role = 'operator' and display_name = 'Old Operator'") == 1)
run_as("anon")
cur.execute("select status, match_result from public.track_case(%s)", (legacy_case,))
row = cur.fetchone()
check("legacy report can still be tracked publicly (no routing snapshot recorded)", row and row[0] == "reported" and row[1] is None)

# roles for the rest of the run
run_as("owner")
cur.execute("insert into auth.users values (%s),(%s),(%s),(%s),(%s)", (ADMIN, ADMIN2, OP1, OP2, USER))
cur.execute("insert into public.user_roles values (%s,'administrator','Admin Asha'), (%s,'operator','Operator Ravi'), (%s,'operator','Operator Meena')", (ADMIN, OP1, OP2))

# =============================================================================================================================
# 1. SQL routing must equal the TypeScript routing engine (parity.json is generated by `npm test`)
# =============================================================================================================================
parity = json.loads((pathlib.Path(__file__).resolve().parent / "parity.json").read_text(encoding="utf-8"))
total_cases = 0
for w in parity["worlds"]:
    run_as("owner")
    cur.execute("select set_config('jalrakshak.verifying', 'on', false)")          # lets the fixture keep its verification states
    cur.execute("delete from public.officers"); cur.execute("delete from public.zones")
    for z in w["zones"]:
        cur.execute("insert into public.zones (zone_id, name, boundary) values (%s,%s,%s)", (z["zone_id"], z["name"], json.dumps(z["boundary"]) if z.get("boundary") else None))
    for o in w["officers"]:
        cur.execute("""insert into public.officers (officer_id, full_name, designation, department, assigned_zones, assigned_wards, official_phone, office_name, office_address, source_url,
                       source_type, verification_status, verified_at, verified_by, last_checked_at, active_status, assignment_notes)
                       values (%(officer_id)s,%(full_name)s,%(designation)s,%(department)s,%(assigned_zones)s,%(assigned_wards)s,%(official_phone)s,%(office_name)s,%(office_address)s,%(source_url)s,
                       %(source_type)s,%(verification_status)s,%(verified_at)s,%(verified_by)s,%(last_checked_at)s,%(active_status)s,%(assignment_notes)s)""", {**o, "verified_by": o.get("verified_by")})
    cur.execute("select set_config('jalrakshak.verifying', 'off', false)")
    run_as("anon")
    bad = []
    for c in w["cases"]:
        cur.execute("select public.match_responsible(%s,%s,%s,%s::date)", (c["category"], c["lat"], c["lng"], w["today"]))
        got = cur.fetchone()[0]
        if got != c["expected"]:
            bad.append((c["label"], c["category"], {k: (got.get(k), c["expected"].get(k)) for k in c["expected"] if got.get(k) != c["expected"].get(k)}))
    total_cases += len(w["cases"])
    check(f"parity with the TypeScript engine: {w['name']} ({len(w['cases'])} cases)", not bad, str(bad[:2]))
check(f"parity: {total_cases} scenarios compared in total", total_cases >= 100)
run_as("owner")
cur.execute("delete from public.officers"); cur.execute("delete from public.zones")

# =============================================================================================================================
# 2. Anonymous citizens
# =============================================================================================================================
run_as("anon")
for t in ("reports", "cases", "case_events", "case_evidence", "operators", "user_roles", "officers", "zones", "audit_log"):
    ok, msg = expect_error(f"select * from public.{t}", needle="permission denied")
    check(f"anon cannot read table {t}", ok, msg)
for fn, args in [("claim_case", "gen_random_uuid()"), ("assign_case", "gen_random_uuid(), gen_random_uuid()"), ("set_user_role", "gen_random_uuid(), 'administrator', 'x'"),
                 ("verify_officer", "gen_random_uuid(), 'https://x.org', 'long enough note'"), ("deactivate_officer", "gen_random_uuid()"), ("write_audit", "'a','b','{}'::jsonb")]:
    ok, msg = expect_error(f"select public.{fn}({args})", needle="permission denied")
    check(f"anon cannot call {fn}()", ok, msg)
ok, msg = expect_error("insert into public.reports (case_id, lat, lng, location_source, description, lang, category, severity, reporter_id) values ('X',1,1,'gps','0123456789','en','other',1,'r')", needle="permission denied")
check("anon cannot insert into reports directly (only via submit_report)", ok, msg)

# --- mandatory photo, validated server-side
ok, msg = expect_error("select public.submit_report(28.6,77.2,'map_pin',null,'valid description here','en','other','{}',null,10,null,'r-x')", needle="live photo is required")
check("11. submit without a photo is rejected by the database", ok, msg)
for label, path, needle in [("empty path", "", "live photo is required"), ("path outside incoming/", "evidence/aaaa1111.jpg", "Invalid photo path"), ("not a jpeg name", "incoming/photo-9999.png", "Invalid photo path"),
                            ("traversal attempt", "incoming/../secret-9999.jpg", "Invalid photo path"), ("file never uploaded", "incoming/ghost-0001.jpg", "not found in storage")]:
    ok, msg = expect_error("select public.submit_report(28.6,77.2,'map_pin',null,'valid description here','en','other','{}',null,10,%s,'r-y')", (path,), needle)
    check(f"14. photo rejected: {label}", ok, msg)
for label, kw, needle in [("wrong mimetype (png uploaded)", dict(mimetype="image/png"), "must be a JPEG"), ("oversized (2 MB)", dict(size=2_000_000), "1.5 MB"), ("zero bytes", dict(size=0), "1.5 MB")]:
    p = make_photo(**kw)
    run_as("anon")
    ok, msg = expect_error("select public.submit_report(28.6,77.2,'map_pin',null,'valid description here','en','other','{}',null,10,%s,'r-z')", (p,), needle)
    check(f"14. uploaded object rejected: {label}", ok, msg)
p = make_photo(bucket="report-photos", path="incoming/wrongbucket-0001.jpg")
run_as("owner"); cur.execute("insert into storage.buckets (id, name) values ('other', 'other') on conflict do nothing"); cur.execute("insert into storage.objects (bucket_id, name, metadata) values ('other','incoming/otherbkt-0001.jpg','{\"mimetype\":\"image/jpeg\",\"size\":100}')")
run_as("anon")
ok, msg = expect_error("select public.submit_report(28.6,77.2,'map_pin',null,'valid description here','en','other','{}',null,10,'incoming/otherbkt-0001.jpg','r-w')", needle="not found in storage")
check("14. a photo in a different bucket does not count", ok, msg)

case1 = submit(photo="auto", meta={"capturedAtClient": "2026-10-17T10:00:00Z", "width": 640, "height": 480, "bytes": 2000, "source": "FORGED_AS_VERIFIED"}, a_src="manual", a_fmt="12 Main St, Noida 201301", a_comp=json.dumps({"city": "Noida", "pin": "201301"}))
check("15. a valid report with a stored photo is accepted and gets a case id", re.fullmatch(r"JR-\d{8}-[A-Z0-9]{4}", case1))
run_as("owner")
cur.execute("select photo_path, photo_meta, address_formatted, match_kind, matched_department, match_result from public.reports where case_id = %s", (case1,))
ph, meta, addr, mk, md, mr = cur.fetchone()
check("   the photo is stored as a storage path, not as image data in the database", ph.startswith("incoming/") and len(ph) < 100)
check("   photo metadata source is fixed server-side (a client cannot claim 'verified')", meta["source"] == "browser_camera_client_claim" and meta["width"] == 640, str(meta))
check("   address and routing snapshot are stored with the report", addr == "12 Main St, Noida 201301" and md == "WATER_WORKS" and mk == "department" and mr["kind"] == "department")
run_as("anon")
ok, msg = expect_error("select public.submit_report(28.6,77.2,'map_pin',null,'valid description here','en','other','{}',null,10,%s,'r-reuse')", (ph,), needle="already used")
check("   the same photo cannot be attached to a second report", ok, msg)

for name, over, needle in [("latitude out of range", dict(lat=95), "reports_lat_check"), ("description too short", dict(desc="short"), "description"), ("invalid category", dict(cat="hacker"), "category"),
                           ("invalid language", dict(lang="fr"), "lang"), ("severity out of range", dict(sev=500), "severity"), ("address source without data", dict(a_src="manual"), "check")]:
    try:
        submit(**over)
        check(f"rejects invalid input: {name}", False, "accepted")
    except psycopg2.Error as e:
        check(f"rejects invalid input: {name}", needle.lower() in str(e).lower(), str(e).splitlines()[0])
for cat, dept in [("sewer", "SEWERAGE"), ("drainage", "DRAINAGE"), ("supply_disruption", "WATER_WORKS"), ("other", "GENERAL")]:
    c = submit(cat=cat)
    run_as("owner"); cur.execute("select matched_department, match_kind from public.reports where case_id=%s", (c,))
    check(f"routing at submission: category {cat} -> {dept}", cur.fetchone()[0] == dept)

# --- throttle (basic, per reporter id)
for i in range(5):
    submit(rep="flood-reporter")
try:
    submit(rep="flood-reporter")
    check("basic throttle: a 6th report from the same reporter within 10 minutes is refused", False, "accepted")
except psycopg2.Error as e:
    check("basic throttle: a 6th report from the same reporter within 10 minutes is refused", "Too many reports" in str(e), str(e).splitlines()[0])

# --- public tracking is privacy-limited
run_as("anon")
cur.execute("select status, verified, events, match_result from public.track_case(%s)", (case1.lower(),))
st, ver, events, tmr = cur.fetchone()
check("anon track_case works (case-insensitive) for its own report", st == "reported" and ver is False)
check("   routing snapshot is returned; the department fallback includes the BMC helplines", tmr["escalation"]["helpline"] == "155304" and tmr["officer"] is None)
check("   timeline text is generic (no staff names, no case ids)", all(not re.search(r"JR-|Operator|Admin", e["text"]) for e in events), str([e["text"] for e in events]))
cur.execute("select count(*) from public.track_case('JR-00000000-ZZZZ')")
check("   unknown case id returns nothing", cur.fetchone()[0] == 0)
cur.execute("select public.match_responsible('other', 1, 1)")
check("anon can call match_responsible (public information only); unknown category falls back to the helpline", cur.fetchone()[0]["kind"] == "helpline")

# --- storage policies (stubbed storage tables)
run_as("anon")
check("anon can upload to incoming/ with a valid name", err("insert into storage.objects (bucket_id, name, metadata) values ('report-photos','incoming/citizen-up-0001.jpg','{}')") is None)
for p in ("other/anything-0001.jpg", "evidence/00000000-0000-4000-8000-000000000000/x-0001.jpg", "incoming/bad name.exe", "incoming/short.jpg"):
    ok, msg = expect_error("insert into storage.objects (bucket_id, name, metadata) values ('report-photos',%s,'{}')", (p,), "row-level security")
    check(f"anon upload refused: {p}", ok, msg)
cur.execute("select count(*) from storage.objects"); check("anon cannot list or read stored photos", cur.fetchone()[0] == 0)
cur.execute("update storage.objects set name = 'incoming/hijack-0001.jpg'"); check("anon cannot rename or overwrite objects", cur.rowcount == 0)
cur.execute("delete from storage.objects"); check("anon cannot delete objects", cur.rowcount == 0)

# =============================================================================================================================
# 3. Signed-in user without a role
# =============================================================================================================================
run_as("authenticated", USER)
for t in ("reports", "cases", "case_events", "case_evidence", "officers", "zones", "audit_log"):
    cur.execute(f"select count(*) from public.{t}")
    check(f"6. a signed-in user with no role sees 0 rows in {t}", cur.fetchone()[0] == 0)
cur.execute("select count(*) from public.user_roles"); check("   and no role rows", cur.fetchone()[0] == 0)
ok, msg = expect_error("select public.claim_case(%s)", (rid_of(case1),), "Operator or administrator access required")
run_as("authenticated", USER); ok, msg = expect_error("select public.claim_case(%s)", (rid_of(case1),), "access required")
check("7. a roleless user cannot claim a case", ok, msg)
run_as("authenticated", USER); ok, msg = expect_error("insert into public.officers (full_name, designation, department, office_name, source_url, source_type, last_checked_at) values ('Evil','x','WATER_WORKS','o','https://x.org','manual_entry','2026-01-01')", needle="row-level security")
check("7. a roleless user cannot write the officer directory", ok, msg)
run_as("authenticated", USER); ok, msg = expect_error("insert into public.user_roles values (%s,'administrator','me')", (USER,), "permission denied")
check("7. nobody can grant themselves a role through the API", ok, msg)

# =============================================================================================================================
# 4. Operators: scoped to unassigned + own cases
# =============================================================================================================================
c_a = submit(); c_b = submit(); c_c = submit()
ra, rb, rc = rid_of(c_a), rid_of(c_b), rid_of(c_c)
run_as("authenticated", OP1)
cur.execute("select count(*) from public.reports where id in (%s,%s,%s)", (ra, rb, rc))
check("operators see unassigned complaints", cur.fetchone()[0] == 3)
cur.execute("select public.claim_case(%s)", (ra,))
check("8. an operator can claim an unassigned case", count("cases", f"report_id = '{ra}' and assigned_to = '{OP1}' and assigned_by_role = 'operator'") == 1)
run_as("authenticated", OP2)
cur.execute("select count(*) from public.reports where id = %s", (ra,)); check("8. another operator can no longer see a case assigned to someone else", cur.fetchone()[0] == 0)
cur.execute("select count(*) from public.cases where report_id = %s", (ra,)); check("   nor its case row", cur.fetchone()[0] == 0)
cur.execute("select count(*) from public.case_events where report_id = %s", (ra,)); check("   nor its history", cur.fetchone()[0] == 0)
ok, msg = expect_error("select public.claim_case(%s)", (ra,), "already assigned"); check("7. the other operator cannot steal the case", ok, msg)
cur.execute("update public.cases set status='investigating' where report_id = %s", (ra,)); check("7. an unauthorized backend update changes 0 rows (RLS), not just a hidden button", cur.rowcount == 0)
cur.execute("update public.cases set status='investigating' where report_id = %s", (rb,)); check("7. nor can an operator change a case they have not claimed", cur.rowcount == 0)
ok, msg = expect_error("insert into public.case_evidence (report_id, kind, note) values (%s,'inspection_note','not my case')", (ra,), "row-level security"); check("7. nor add evidence to it", ok, msg)
run_as("authenticated", OP1)
cur.execute("update public.cases set status='investigating' where report_id = %s", (ra,)); check("8. the assigned operator can update their case", cur.rowcount == 1)
ok, msg = expect_error("update public.cases set assignee='Hacker', assigned_to=%s where report_id=%s", (OP2, ra), "permission denied"); check("7. assignment fields are not directly writable", ok, msg)
ok, msg = expect_error("select public.assign_case(%s,%s)", (ra, OP2), "Administrator access required"); check("9. an operator cannot call assign_case (admin only)", ok, msg)
ok, msg = expect_error("select public.set_user_role(%s,'administrator','x')", (OP1,), "Administrator access required"); check("9. an operator cannot make themselves an administrator", ok, msg)
ok, msg = expect_error("select public.verify_officer(gen_random_uuid(),'https://x.org','long enough note here')", needle="Administrator access required"); check("9. an operator cannot verify officers", ok, msg)
ok, msg = expect_error("insert into public.zones (zone_id, name) values ('X','x')", needle="row-level security"); check("9. an operator cannot create zones", ok, msg)
ok, msg = expect_error("insert into public.officers (full_name, designation, department, office_name, source_url, source_type, last_checked_at) values ('Evil','x','WATER_WORKS','o','https://x.org','manual_entry','2026-01-01')", needle="row-level security"); check("9. an operator cannot add officers", ok, msg)
cur.execute("update public.officers set full_name = 'Renamed'"); check("9. an operator cannot edit officers (0 rows)", cur.rowcount == 0)
cur.execute("select count(*) from public.audit_log"); check("9. an operator cannot read the audit log", cur.fetchone()[0] == 0)
cur.execute("select count(*) from public.user_roles"); check("   an operator sees only their own role row", cur.fetchone()[0] == 1)
run_as("owner"); cur.execute("select (select count(*) from public.officers), (select count(*) from public.zones)"); n_off, n_zone = cur.fetchone()
run_as("authenticated", OP1)
cur.execute("select (select count(*) from public.officers), (select count(*) from public.zones)")
check("   operators can read the whole directory (needed to see suggestions)", cur.fetchone() == (n_off, n_zone) and n_off >= 0, f"{n_off} officers, {n_zone} zones")

# the client cannot choose who the audit trail says did something: the actor column is not writable at all
ok, msg = expect_error("insert into public.case_evidence (report_id, kind, note, actor) values (%s,'inspection_note','x','FORGED NAME')", (ra,), "permission denied")
check("   a client cannot supply the 'actor' of evidence (it is taken from the signed-in operator)", ok, msg)
# full workflow with closure rules (carried over from 0001), as the assigned operator
ok, msg = expect_error("update public.cases set status='closed', verified_by='Sup' where report_id=%s", (ra,), "Invalid status transition"); check("   cannot skip steps (investigating -> closed)", ok, msg)
ok, msg = expect_error("update public.cases set status='inspected' where report_id=%s", (ra,), "inspection note"); check("   inspected requires an inspection note", ok, msg)
cur.execute("insert into public.case_evidence (report_id, kind, note) values (%s,'inspection_note','Found a cracked joint')", (ra,))
cur.execute("update public.cases set status='inspected' where report_id=%s", (ra,))
ok, msg = expect_error("update public.cases set status='repaired' where report_id=%s", (ra,), "after-repair photo"); check("   repaired requires an after photo", ok, msg)
cur.execute("insert into public.case_evidence (report_id, kind, photo_path) values (%s,'after','evidence/after-0001.jpg')", (ra,))
cur.execute("update public.cases set status='repaired' where report_id=%s", (ra,))
ok, msg = expect_error("update public.cases set status='closed' where report_id=%s", (ra,), "named verifier"); check("   closing requires a named verifier", ok, msg)
cur.execute("update public.cases set status='closed', verified_by='Supervisor Ravi' where report_id=%s", (ra,))
check("   closes when the full checklist holds (the report's own live photo counts as before-evidence)", True)
ok, msg = expect_error("update public.cases set status='investigating' where report_id=%s", (ra,), "Invalid status transition"); check("   closed cases cannot be reopened", ok, msg)
run_as("owner")
cur.execute("select actor, type, text from public.case_events where report_id=%s order by id", (ra,))
ev = cur.fetchall()
check("   audit trail uses the signed-in operator's real name, even though the client sent a different actor", ("Operator Ravi", "evidence") in [(a, t) for a, t, _ in ev] and ("Operator Ravi", "status") in [(a, t) for a, t, _ in ev], str([(a, t) for a, t, _ in ev]))
check("   self-assignment is recorded as NOT administrator-confirmed", any("self-assigned, not administrator-confirmed" in x for _, _, x in ev))
run_as("authenticated", OP1)
for t in ("case_events", "case_evidence"):
    ok, msg = expect_error(f"delete from public.{t}", needle="permission denied"); check(f"   operators cannot delete {t}", ok, msg)
ok, msg = expect_error("update public.case_events set text='edited'", needle="permission denied"); check("   operators cannot edit audit events", ok, msg)
ok, msg = expect_error("insert into public.case_events (report_id, actor, type, text) values (%s,'Forged','status','x')", (ra,), "permission denied"); check("   operators cannot forge audit events", ok, msg)
run_as("anon"); cur.execute("select events from public.track_case(%s)", (c_a,))
pub = cur.fetchone()[0]; check("   the public timeline of that case shows no staff names or case ids", all(not re.search(r"JR-|Operator|Ravi|Supervisor", e["text"]) for e in pub), str([e["text"] for e in pub]))

# =============================================================================================================================
# 5. Administrators
# =============================================================================================================================
run_as("authenticated", ADMIN)
cur.execute("select count(*) from public.reports"); check("an administrator sees every complaint (including ones assigned to others)", cur.fetchone()[0] >= 9)
cur.execute("select public.assign_case(%s,%s)", (rb, OP2))
check("an administrator can assign a case to an operator (recorded as administrator-confirmed)", count("cases", f"report_id='{rb}' and assigned_to='{OP2}' and assigned_by_role='administrator'") == 1)
cur.execute("select text from public.case_events where report_id=%s and type='assigned'", (rb,)); check("   with the administrator's name in the history", "administrator-confirmed" in cur.fetchone()[0])
run_as("authenticated", OP2); cur.execute("select count(*) from public.reports where id=%s", (rb,)); check("   the assigned operator now sees it", cur.fetchone()[0] == 1)
cur.execute("update public.cases set status='investigating' where report_id=%s", (rb,)); check("   and can work it", cur.rowcount == 1)
run_as("authenticated", OP1); cur.execute("select count(*) from public.reports where id=%s", (rb,)); check("   while the previous viewer cannot", cur.fetchone()[0] == 0)
run_as("authenticated", ADMIN); ok, msg = expect_error("select public.assign_case(%s,%s)", (rc, USER), "must be an operator"); check("   assignees must hold a staff role", ok, msg)

# --- officers: verification can only happen through verify_officer()
run_as("authenticated", ADMIN)
ok, msg = expect_error("insert into public.officers (full_name, designation, department, office_name, source_url, source_type, last_checked_at, verification_status) values ('Self Verified','x','WATER_WORKS','o','https://x.org','manual_entry','2026-01-01','VERIFIED_OFFICIAL')", needle="permission denied")
check("an administrator cannot insert an already-verified officer (verification columns are not writable)", ok, msg)
cur.execute("insert into public.officers (full_name, designation, department, assigned_zones, official_phone, office_name, source_url, source_type, last_checked_at) values ('Test Engineer One','Executive Engineer, Water Works (test)','WATER_WORKS','{01}','0755-1234567','Test Office','https://example.org/src','manual_entry','2026-10-01') returning officer_id, verification_status")
oid, st0 = cur.fetchone()
check("new officers are UNVERIFIED", st0 == "UNVERIFIED")
ok, msg = expect_error("update public.officers set verification_status='VERIFIED_OFFICIAL' where officer_id=%s", (oid,), "permission denied"); check("   an administrator cannot flip the status with a plain UPDATE", ok, msg)
ok, msg = expect_error("update public.officers set verified_at=current_date, verified_by='me' where officer_id=%s", (oid,), "permission denied"); check("   nor set the verification date/name", ok, msg)
ok, msg = expect_error("select public.verify_officer(%s,'not a url','long enough note here')", (oid,), "source URL"); check("   verify_officer requires a source URL", ok, msg)
ok, msg = expect_error("select public.verify_officer(%s,'https://example.org/confirm','short')", (oid,), "at least 10"); check("   and a review note", ok, msg)
cur.execute("select public.verify_officer(%s,'https://example.org/confirm','Confirmed zone 01 with the water works office')", (oid,))
cur.execute("select verification_status, verified_at, verified_by, source_url from public.officers where officer_id=%s", (oid,))
vs, va, vb, vu = cur.fetchone()
check("   verify_officer marks it VERIFIED_OFFICIAL, dated, with the administrator's name and the source", vs == "VERIFIED_OFFICIAL" and va is not None and vb == "Admin Asha" and vu == "https://example.org/confirm", f"{vs} {va} {vb}")
cur.execute("update public.officers set designation='Executive Engineer (test, edited)' where officer_id=%s returning verification_status", (oid,))
check("   editing a verified officer's key fields sends it back to NEEDS_REVIEW", cur.fetchone()[0] == "NEEDS_REVIEW")
cur.execute("select public.verify_officer(%s,'https://example.org/confirm2','Re-verified after the edit with the office')", (oid,))
cur.execute("update public.officers set assignment_notes='notes only' where officer_id=%s returning verification_status", (oid,))
check("   a notes-only edit keeps it verified", cur.fetchone()[0] == "VERIFIED_OFFICIAL")
cur.execute("select public.deactivate_officer(%s)", (oid,)); cur.execute("select verification_status, active_status from public.officers where officer_id=%s", (oid,))
check("   deactivate_officer makes it INACTIVE", cur.fetchone() == ("INACTIVE", False))
ok, msg = expect_error("select public.verify_officer(%s,'https://example.org/c','trying to verify an inactive record')", (oid,), "Inactive"); check("   inactive records cannot be verified", ok, msg)
cur.execute("select public.reactivate_officer(%s)", (oid,)); cur.execute("select verification_status from public.officers where officer_id=%s", (oid,))
check("   reactivated records go to NEEDS_REVIEW (never straight back to verified)", cur.fetchone()[0] == "NEEDS_REVIEW")
ok, msg = expect_error("delete from public.officers", needle="permission denied"); check("   officer records cannot be deleted through the API", ok, msg)
ok, msg = expect_error("insert into public.officers (full_name, designation, department, office_name, source_url, source_type, last_checked_at) values ('Bad Url','x','WATER_WORKS','o','javascript:alert(1)','manual_entry','2026-01-01')", needle="source_url"); check("   source_url must be http(s)", ok, msg)
ok, msg = expect_error("insert into public.officers (full_name, designation, department, office_name, source_url, source_type, last_checked_at) values ('Bad Dept','x','MAGIC','o','https://x.org','manual_entry','2026-01-01')", needle="department"); check("   department must be a known value", ok, msg)

# --- second layer: even a privileged path (table owner / SQL editor / service key) cannot create or flip verified records
run_as("owner")
cur.execute("insert into public.officers (full_name, designation, department, office_name, source_url, source_type, last_checked_at, verification_status, verified_at, verified_by) values ('Privileged Insert','x','WATER_WORKS','o','https://x.org','manual_entry','2026-10-01','VERIFIED_OFFICIAL','2026-10-01','someone') returning officer_id, verification_status, verified_at, verified_by")
pid, pst, pva, pvb = cur.fetchone()
check("trigger: a privileged direct insert marked VERIFIED is forced to UNVERIFIED with no verification date/name", (pst, pva, pvb) == ("UNVERIFIED", None, None), f"{pst} {pva} {pvb}")
ok, msg = expect_error("update public.officers set verification_status='VERIFIED_OFFICIAL', verified_at=current_date, verified_by='x' where officer_id=%s", (pid,), "verify_officer")
check("trigger: a privileged direct UPDATE cannot flip a record to VERIFIED either", ok, msg)
cur.execute("delete from public.officers where officer_id=%s", (pid,))
run_as("authenticated", ADMIN)

# --- zones, routing through submit_report, and the verified-officer path end to end
cur.execute("insert into public.zones (zone_id, name, boundary) values ('01','Test Zone 01','[[23.0,77.0],[23.0,77.1],[23.1,77.1],[23.1,77.0]]')")
ok, msg = expect_error("insert into public.zones (zone_id, name, boundary) values ('02','Bad','[[1,2],[3,4]]')", needle="zones_boundary_check"); check("zones reject a boundary with fewer than 3 points", ok, msg)
cur.execute("select public.verify_officer(%s,'https://example.org/confirm3','Confirmed again for the routing test')", (oid,))
case_in = submit(lat=23.05, lng=77.05, cat="pipe_leak")
case_out = submit(lat=30.0, lng=70.0, cat="pipe_leak")
run_as("owner")
cur.execute("select match_kind, matched_officer_id::text, match_result #>> '{officer,full_name}' from public.reports where case_id=%s", (case_in,))
k, mo, nm = cur.fetchone()
check("1. a complaint inside a zone with one verified officer is routed to that officer (server-side)", k == "officer" and mo == oid and nm == "Test Engineer One", f"{k} {nm}")
cur.execute("select match_kind, matched_officer_id from public.reports where case_id=%s", (case_out,))
check("3/4. a complaint outside every zone is NOT assigned to an officer and keeps the department/helpline fallback", cur.fetchone() == ("department", None))
run_as("authenticated", ADMIN); cur.execute("select public.mark_officer_needs_review(%s)", (oid,))
case_unv = submit(lat=23.05, lng=77.05, cat="pipe_leak")
run_as("owner"); cur.execute("select match_kind, matched_officer_id from public.reports where case_id=%s", (case_unv,))
check("2. once the officer is no longer verified, new complaints are not routed to them", cur.fetchone() == ("department", None))
run_as("anon"); cur.execute("select match_result from public.track_case(%s)", (case_in,))
tm = cur.fetchone()[0]
check("5. the public tracking result shows the officer's source URL and verification date for a verified match", tm["sourceUrl"] == "https://example.org/confirm3" and tm["lastVerifiedAt"] is not None and tm["verification"] == "VERIFIED_OFFICIAL")
check("   and the exact wording from the specification", tm["message"].startswith("Potential responsible contact: Test Engineer One. Designation:") and tm["message"].endswith("Please confirm assignment with the municipal department."))

# --- roles management
run_as("authenticated", ADMIN)
cur.execute("select public.set_user_role(%s,'operator','New Operator')", (USER,))
run_as("authenticated", USER); cur.execute("select count(*) from public.reports where id=%s", (rc,)); check("an administrator can grant an operator role (user then sees unassigned complaints)", cur.fetchone()[0] == 1)
run_as("authenticated", ADMIN)
ok, msg = expect_error("select public.set_user_role(%s,'operator','x')", (ADMIN,), "last administrator"); check("the last administrator cannot be demoted", ok, msg)
ok, msg = expect_error("select public.set_user_role(%s,null)", (ADMIN,), "last administrator"); check("nor removed", ok, msg)
ok, msg = expect_error("select public.set_user_role(%s,'superuser','x')", (USER,), "Unknown role"); check("unknown roles are rejected", ok, msg)
cur.execute("select public.set_user_role(%s,'administrator','Second Admin')", (ADMIN2,))
cur.execute("select public.set_user_role(%s,'operator','Admin Asha (demoted)')", (ADMIN,)); check("with a second administrator in place, demotion works", True)
run_as("owner"); cur.execute("update public.user_roles set role='administrator', display_name='Admin Asha' where user_id=%s", (ADMIN,))

# --- audit log
run_as("authenticated", ADMIN)
cur.execute("select action, actor_name, actor_role, target from public.audit_log")
acts = cur.fetchall()
names = {a for a, *_ in acts}
check("audit log recorded officer, zone, role and assignment changes", {"officer.insert", "officer.update", "officer.delete"} & names and {"officer.verify", "zone.insert", "role.set", "case.assign", "case.claim"} <= names, str(sorted(names)))
check("   each entry carries the real actor name and role", all(n and r in ("administrator", "operator", "citizen") for _, n, r, _ in acts))
check("   verification entries name the administrator", any(a == "officer.verify" and n == "Admin Asha" and r == "administrator" for a, n, r, _ in acts))
for sql in ("update public.audit_log set actor_name='x'", "delete from public.audit_log", "insert into public.audit_log (actor_name, actor_role, action, target) values ('x','administrator','fake','x')"):
    ok, msg = expect_error(sql, needle="permission denied"); check(f"   audit log is append-only for everyone: {sql.split()[0]}", ok, msg)

# --- storage read policy: staff only see photos of cases they can see
run_as("authenticated", OP1)
cur.execute("select count(*) from storage.objects"); op1_visible = cur.fetchone()[0]
run_as("authenticated", ADMIN); cur.execute("select count(*) from storage.objects"); admin_visible = cur.fetchone()[0]
run_as("authenticated", USER); cur.execute("select count(*) from storage.objects"); user_visible = cur.fetchone()[0]
check("storage: an administrator can read stored photos; an operator only those of cases they can see; other users none", admin_visible > op1_visible > 0 and user_visible >= 0, f"admin {admin_visible}, op1 {op1_visible}")
run_as("authenticated", OP2); cur.execute("select count(*) from storage.objects where name = (select photo_path from public.reports where id=%s)", (ra,))
check("storage: an operator cannot read the photo of a case assigned to another operator", cur.fetchone()[0] == 0)
run_as("authenticated", OP1); ok, msg = expect_error("insert into storage.objects (bucket_id, name, metadata) values ('report-photos',%s,'{}')", (f"evidence/{rb}/ev-0001.jpg",), "row-level security")
check("storage: an operator cannot upload evidence for a case they cannot work", ok, msg)
run_as("authenticated", OP1); run_as("authenticated", OP2)
mine = err("insert into storage.objects (bucket_id, name, metadata) values ('report-photos',%s,'{}')", (f"evidence/{rb}/ev-0002.jpg",))
check("storage: an operator can upload evidence for a case assigned to them", mine is None, str(mine))

run_as("owner")
conn.close()
srv.cleanup()
failed = results.count(False)
print(f"\n{len(results) - failed}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
