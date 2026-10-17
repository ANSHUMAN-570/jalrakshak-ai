-- JalRakshak AI: roles, officer directory, complaint routing, mandatory photo evidence (PostgreSQL / Supabase)
--
-- Backward compatible with 0001: existing reports keep their rows (photo_path stays nullable for legacy rows),
-- the `operators` table is migrated into `user_roles`, and no column is renamed or dropped.
--
-- Security model (enforced in the database, not in the browser):
--   citizen        anonymous. Can only call submit_report(), track_case(), match_responsible().
--   operator       row in user_roles. Sees unassigned complaints and complaints assigned to them; may only change cases
--                  assigned to them; may claim an unassigned case for themselves.
--   administrator  row in user_roles. Sees everything; assigns cases; manages officers, zones and roles; reads audit_log.
--   The role is read from user_roles using auth.uid(); nothing the browser sends is trusted.
--
-- Apply after 0001. To create the first administrator (project owner, in the SQL editor):
--   insert into public.user_roles (user_id, role, display_name) values ('<auth user uuid>', 'administrator', 'Name');

-- ---------------------------------------------------------------------------
-- 1. More complaint categories (sewer and drainage are NOT water works)
-- ---------------------------------------------------------------------------
alter table public.reports drop constraint reports_category_check;
alter table public.reports add constraint reports_category_check check (category in
  ('burst_main', 'pipe_leak', 'meter_valve', 'supply_disruption', 'contamination', 'sewer', 'drainage', 'overflow', 'other'));

-- ---------------------------------------------------------------------------
-- 2. Roles
-- ---------------------------------------------------------------------------
create table public.user_roles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  role         text not null check (role in ('operator', 'administrator')),
  display_name text not null check (length(trim(display_name)) > 0),
  created_at   timestamptz not null default now()
);
insert into public.user_roles (user_id, role, display_name)
  select user_id, 'operator', display_name from public.operators on conflict (user_id) do nothing;
comment on table public.operators is 'DEPRECATED by 0002: roles now live in public.user_roles. Kept so 0001 data is not lost.';

create or replace function public.is_operator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid());   -- operators and administrators
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'administrator');
$$;

create function public.current_role_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.user_roles where user_id = auth.uid()), 'citizen');
$$;

create or replace function public.current_actor() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from public.user_roles where user_id = auth.uid()), 'system');
$$;

-- ---------------------------------------------------------------------------
-- 3. Audit log (written only by triggers / SECURITY DEFINER functions)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor_user uuid,
  actor_name text not null,
  actor_role text not null,
  action     text not null,
  target     text not null,
  detail     jsonb not null default '{}'::jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);

create function public.write_audit(p_action text, p_target text, p_detail jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_log (actor_user, actor_name, actor_role, action, target, detail)
  values (auth.uid(), public.current_actor(), public.current_role_name(), p_action, p_target, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function public.write_audit(text, text, jsonb) from public;

-- Role management: administrators only, never the last administrator.
create function public.set_user_role(p_user uuid, p_role text, p_name text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old text;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode = 'insufficient_privilege'; end if;
  if p_role is not null and p_role not in ('operator', 'administrator') then raise exception 'Unknown role %', p_role using errcode = 'check_violation'; end if;
  select role into v_old from public.user_roles where user_id = p_user;
  if v_old = 'administrator' and (p_role is distinct from 'administrator')
     and (select count(*) from public.user_roles where role = 'administrator') <= 1 then
    raise exception 'Cannot remove or demote the last administrator' using errcode = 'check_violation';
  end if;
  if p_role is null then
    delete from public.user_roles where user_id = p_user;
  else
    insert into public.user_roles (user_id, role, display_name) values (p_user, p_role, coalesce(nullif(trim(p_name), ''), 'Unnamed'))
    on conflict (user_id) do update set role = excluded.role, display_name = coalesce(nullif(trim(p_name), ''), public.user_roles.display_name);
  end if;
  perform public.write_audit('role.set', p_user::text, jsonb_build_object('old', v_old, 'new', p_role));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Zones and the officer directory
-- ---------------------------------------------------------------------------
create table public.zones (
  zone_id    text primary key check (length(trim(zone_id)) between 1 and 20),
  name       text not null check (length(trim(name)) between 1 and 80),
  -- optional boundary ring as [[lat,lng],...]; without it the zone can never be resolved from coordinates
  boundary   jsonb check (boundary is null or (jsonb_typeof(boundary) = 'array' and jsonb_array_length(boundary) >= 3)),
  notes      text check (notes is null or length(notes) <= 300),
  updated_at timestamptz not null default now()
);

create table public.officers (
  officer_id          uuid primary key default gen_random_uuid(),
  full_name           text not null check (length(trim(full_name)) between 2 and 120),
  designation         text not null check (length(trim(designation)) between 1 and 240),
  department          text not null check (department in ('WATER_WORKS', 'SEWERAGE', 'SEWERAGE_AND_WATER_WORKS', 'DRAINAGE', 'GENERAL')),
  assigned_zones      text[] not null default '{}',
  assigned_wards      text[] not null default '{}',
  official_phone      text check (official_phone is null or official_phone ~ '^[+0-9][0-9 ()-]{5,19}$'),
  official_email      text check (official_email is null or official_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  office_name         text not null check (length(trim(office_name)) > 0),
  office_address      text not null default '',
  source_url          text not null check (source_url ~ '^https?://'),
  source_type         text not null check (source_type in ('official_portal', 'official_directory', 'third_party_directory', 'manual_entry', 'csv_import')),
  verification_status text not null default 'UNVERIFIED' check (verification_status in ('VERIFIED_OFFICIAL', 'UNVERIFIED', 'NEEDS_REVIEW', 'INACTIVE')),
  verified_at         date,
  verified_by         text,
  last_checked_at     date not null,
  active_status       boolean not null default true,
  assignment_notes    text not null default '' check (length(assignment_notes) <= 600),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((verification_status = 'INACTIVE') = (not active_status)),
  check (verification_status <> 'VERIFIED_OFFICIAL' or (verified_at is not null and verified_by is not null))
);
create index officers_dept_idx on public.officers (department);

-- Verification can only be reached through verify_officer(); direct writes are forced to UNVERIFIED / demoted.
create function public.officers_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean := coalesce(current_setting('jalrakshak.verifying', true), '') = 'on';
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if not v_ok then
      new.verification_status := case when new.active_status then 'UNVERIFIED' else 'INACTIVE' end;
      new.verified_at := null;
      new.verified_by := null;
    end if;
    return new;
  end if;
  if not v_ok then
    if new.verification_status = 'VERIFIED_OFFICIAL' and old.verification_status is distinct from 'VERIFIED_OFFICIAL' then
      raise exception 'Officers can only be verified through verify_officer()' using errcode = 'check_violation';
    end if;
    if new.verified_at is distinct from old.verified_at or new.verified_by is distinct from old.verified_by then
      raise exception 'Verification fields can only change through verify_officer()' using errcode = 'check_violation';
    end if;
    if old.verification_status = 'VERIFIED_OFFICIAL' and new.verification_status = 'VERIFIED_OFFICIAL'
       and (new.full_name, new.designation, new.department, new.assigned_zones, new.assigned_wards, new.official_phone, new.official_email, new.office_name, new.office_address)
           is distinct from
           (old.full_name, old.designation, old.department, old.assigned_zones, old.assigned_wards, old.official_phone, old.official_email, old.office_name, old.office_address) then
      new.verification_status := 'NEEDS_REVIEW';     -- editing key fields of a verified record sends it back for review
    end if;
  end if;
  return new;
end;
$$;
create trigger officers_before_write before insert or update on public.officers
  for each row execute function public.officers_guard();

create function public.audit_officers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.write_audit('officer.' || lower(tg_op),
    (case when tg_op = 'DELETE' then old.officer_id else new.officer_id end)::text,
    jsonb_build_object('name', case when tg_op = 'DELETE' then old.full_name else new.full_name end,
                       'old_status', case when tg_op = 'UPDATE' then old.verification_status end,
                       'new_status', case when tg_op <> 'DELETE' then new.verification_status end));
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger officers_audit after insert or update or delete on public.officers
  for each row execute function public.audit_officers();

create function public.audit_zones() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.write_audit('zone.' || lower(tg_op), case when tg_op = 'DELETE' then old.zone_id else new.zone_id end,
    jsonb_build_object('name', case when tg_op = 'DELETE' then old.name else new.name end));
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger zones_audit after insert or update or delete on public.zones
  for each row execute function public.audit_zones();

create function public.verify_officer(p_id uuid, p_source_url text, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_active boolean;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode = 'insufficient_privilege'; end if;
  if p_source_url is null or p_source_url !~ '^https?://' then raise exception 'A source URL (http/https) is required' using errcode = 'check_violation'; end if;
  if p_notes is null or length(trim(p_notes)) < 10 then raise exception 'Describe what was confirmed (at least 10 characters)' using errcode = 'check_violation'; end if;
  select active_status into v_active from public.officers where officer_id = p_id;
  if v_active is null then raise exception 'Officer not found' using errcode = 'no_data_found'; end if;
  if not v_active then raise exception 'Inactive records cannot be verified' using errcode = 'check_violation'; end if;
  perform set_config('jalrakshak.verifying', 'on', true);
  update public.officers set verification_status = 'VERIFIED_OFFICIAL', verified_at = current_date, verified_by = public.current_actor(),
         last_checked_at = current_date, source_url = trim(p_source_url), assignment_notes = left(trim(p_notes), 600)
   where officer_id = p_id;
  perform set_config('jalrakshak.verifying', 'off', true);
  perform public.write_audit('officer.verify', p_id::text, jsonb_build_object('source_url', p_source_url));
end;
$$;

create function public.deactivate_officer(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode = 'insufficient_privilege'; end if;
  update public.officers set active_status = false, verification_status = 'INACTIVE' where officer_id = p_id;
  if not found then raise exception 'Officer not found' using errcode = 'no_data_found'; end if;
end;
$$;

create function public.reactivate_officer(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode = 'insufficient_privilege'; end if;
  update public.officers set active_status = true, verification_status = 'NEEDS_REVIEW' where officer_id = p_id;  -- never straight back to verified
  if not found then raise exception 'Officer not found' using errcode = 'no_data_found'; end if;
end;
$$;

create function public.mark_officer_needs_review(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode = 'insufficient_privilege'; end if;
  update public.officers set verification_status = 'NEEDS_REVIEW' where officer_id = p_id and active_status;
  if not found then raise exception 'Officer not found or inactive' using errcode = 'no_data_found'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Deterministic routing (mirrors src/lib/routing.ts; parity is tested)
-- ---------------------------------------------------------------------------
create function public.point_in_ring(p_lat double precision, p_lng double precision, p_ring jsonb) returns boolean
language plpgsql immutable as $$
declare
  n int := jsonb_array_length(p_ring);
  i int; j int;
  yi double precision; xi double precision; yj double precision; xj double precision;
  inside boolean := false;
begin
  j := n - 1;
  for i in 0 .. n - 1 loop
    yi := (p_ring -> i ->> 0)::double precision; xi := (p_ring -> i ->> 1)::double precision;
    yj := (p_ring -> j ->> 0)::double precision; xj := (p_ring -> j ->> 1)::double precision;
    if (yi > p_lat) <> (yj > p_lat) and p_lng < ((xj - xi) * (p_lat - yi)) / (yj - yi) + xi then inside := not inside; end if;
    j := i;
  end loop;
  return inside;
end;
$$;

create function public.match_responsible(p_category text, p_lat double precision, p_lng double precision, p_today date default current_date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_dept text;
  v_label text;
  v_esc jsonb := jsonb_build_object('helpline', '155304', 'support', '1800-233-0014', 'office', 'Bhopal Municipal Corporation (head office)',
                                    'officePhone', '+91-755-2701222', 'officeEmail', 'commoffice@bmconline.gov.in');
  v_help text := 'Please contact BMC at 155304 or 1800-233-0014.';
  v_eligible text[];
  v_eligible_n int;
  v_zone_n int; v_hits int; v_zone public.zones;
  v_covering int; v_verified int;
  v_off public.officers;
begin
  v_dept := case p_category
    when 'burst_main' then 'WATER_WORKS' when 'pipe_leak' then 'WATER_WORKS' when 'meter_valve' then 'WATER_WORKS'
    when 'supply_disruption' then 'WATER_WORKS' when 'contamination' then 'WATER_WORKS' when 'overflow' then 'WATER_WORKS'
    when 'sewer' then 'SEWERAGE' when 'drainage' then 'DRAINAGE' else 'GENERAL' end;
  v_label := case v_dept when 'WATER_WORKS' then 'Water Works' when 'SEWERAGE' then 'Sewerage' when 'DRAINAGE' then 'Drainage / Storm water' else 'General civic issues' end;
  v_eligible := case v_dept when 'WATER_WORKS' then array['WATER_WORKS', 'SEWERAGE_AND_WATER_WORKS']
                            when 'SEWERAGE' then array['SEWERAGE', 'SEWERAGE_AND_WATER_WORKS']
                            when 'DRAINAGE' then array['DRAINAGE'] else array['GENERAL'] end;

  if v_dept = 'GENERAL' then
    return jsonb_build_object('kind', 'helpline', 'department', v_dept, 'departmentLabel', v_label, 'zone', null, 'officer', null, 'verification', null, 'sourceUrl', null, 'lastVerifiedAt', null,
      'explanation', 'The category does not map to a specific department, so no department or officer is suggested.',
      'message', 'We could not determine which BMC department handles this complaint. ' || v_help, 'escalation', v_esc);
  end if;

  select count(*) into v_eligible_n from public.officers where department = any (v_eligible);
  if v_dept = 'DRAINAGE' and v_eligible_n = 0 then
    return jsonb_build_object('kind', 'department', 'department', v_dept, 'departmentLabel', v_label, 'zone', null, 'officer', null, 'verification', null, 'sourceUrl', null, 'lastVerifiedAt', null,
      'explanation', 'Drainage / waterlogging complaints are routed to a drainage department, but no officer records exist for it.',
      'message', 'Your complaint appears to concern BMC ' || v_label || '. We could not verify the currently responsible zone-level officer. ' || v_help, 'escalation', v_esc);
  end if;

  select count(*) into v_zone_n from public.zones where boundary is not null and jsonb_array_length(boundary) >= 3;
  if v_zone_n = 0 then
    return jsonb_build_object('kind', 'department', 'department', v_dept, 'departmentLabel', v_label, 'zone', null, 'officer', null, 'verification', null, 'sourceUrl', null, 'lastVerifiedAt', null,
      'explanation', 'Department matched from the complaint category (' || v_label || '). No verified zone boundaries are loaded, so the location cannot be mapped to a zone.',
      'message', 'Your complaint appears to concern BMC ' || v_label || '. We could not verify the currently responsible zone-level officer. ' || v_help, 'escalation', v_esc);
  end if;

  select count(*) into v_hits from public.zones z where z.boundary is not null and jsonb_array_length(z.boundary) >= 3 and public.point_in_ring(p_lat, p_lng, z.boundary);
  if v_hits <> 1 then
    return jsonb_build_object('kind', 'department', 'department', v_dept, 'departmentLabel', v_label, 'zone', null, 'officer', null, 'verification', null, 'sourceUrl', null, 'lastVerifiedAt', null,
      'explanation', case when v_hits = 0 then 'Department matched from the complaint category (' || v_label || '). The location is outside every configured zone boundary.'
                          else 'Department matched from the complaint category (' || v_label || '). The location falls inside more than one configured zone (' ||
                               (select string_agg(zone_id, ', ' order by zone_id) from public.zones z where z.boundary is not null and jsonb_array_length(z.boundary) >= 3 and public.point_in_ring(p_lat, p_lng, z.boundary)) || ').' end,
      'message', 'Your complaint appears to concern BMC ' || v_label || '. We could not verify the currently responsible zone-level officer. ' || v_help, 'escalation', v_esc);
  end if;

  select * into v_zone from public.zones z where z.boundary is not null and jsonb_array_length(z.boundary) >= 3 and public.point_in_ring(p_lat, p_lng, z.boundary);
  select count(*) into v_covering from public.officers where department = any (v_eligible) and v_zone.zone_id = any (assigned_zones);
  select count(*) into v_verified from public.officers
   where department = any (v_eligible) and v_zone.zone_id = any (assigned_zones)
     and active_status and verification_status = 'VERIFIED_OFFICIAL' and verified_at is not null and (p_today - verified_at) <= 180;

  if v_verified = 1 then
    select * into v_off from public.officers
     where department = any (v_eligible) and v_zone.zone_id = any (assigned_zones)
       and active_status and verification_status = 'VERIFIED_OFFICIAL' and verified_at is not null and (p_today - verified_at) <= 180;
    return jsonb_build_object('kind', 'officer', 'department', v_dept, 'departmentLabel', v_label,
      'zone', jsonb_build_object('id', v_zone.zone_id, 'name', v_zone.name),
      'officer', jsonb_strip_nulls(jsonb_build_object('officer_id', v_off.officer_id, 'full_name', v_off.full_name, 'designation', v_off.designation,
                  'zone', v_zone.name || ' (zone ' || v_zone.zone_id || ')', 'office_name', v_off.office_name, 'official_phone', v_off.official_phone, 'official_email', v_off.official_email)),
      'verification', v_off.verification_status, 'sourceUrl', v_off.source_url, 'lastVerifiedAt', v_off.verified_at,
      'explanation', 'Category "' || p_category || '" maps to ' || v_label || '; the location is inside zone ' || v_zone.zone_id || '; ' || v_off.full_name || ' is the only active, currently verified ' || v_label || ' officer assigned to that zone.',
      'message', 'Potential responsible contact: ' || v_off.full_name || '. Designation: ' || v_off.designation || '. Assigned area: ' || v_zone.name || ' (zone ' || v_zone.zone_id || '). Please confirm assignment with the municipal department.',
      'escalation', v_esc);
  end if;

  return jsonb_build_object('kind', 'department', 'department', v_dept, 'departmentLabel', v_label,
    'zone', jsonb_build_object('id', v_zone.zone_id, 'name', v_zone.name), 'officer', null, 'verification', null, 'sourceUrl', null, 'lastVerifiedAt', null,
    'explanation', case when v_verified > 1 then 'Zone ' || v_zone.zone_id || ' matched, but ' || v_verified || ' verified officers cover it, so no single officer is named.'
                        when v_covering > 0 then 'Zone ' || v_zone.zone_id || ' matched, but the officer record(s) for it are not currently verified (unverified, needs review, expired or inactive), so none is named.'
                        else 'Zone ' || v_zone.zone_id || ' matched, but no officer assignment is recorded for ' || v_label || ' in that zone.' end,
    'message', 'Your complaint appears to concern BMC ' || v_label || '. We could not verify the currently responsible zone-level officer. ' || v_help, 'escalation', v_esc);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Reports: routing snapshot, photo metadata
-- ---------------------------------------------------------------------------
alter table public.reports
  add column match_result       jsonb,                 -- public-safe routing snapshot taken at submission
  add column matched_department text,
  add column matched_officer_id uuid references public.officers (officer_id),
  add column match_kind         text check (match_kind is null or match_kind in ('officer', 'department', 'helpline')),
  add column photo_meta         jsonb;                 -- CLIENT-PROVIDED capture details; never proof of authenticity

-- ---------------------------------------------------------------------------
-- 7. submit_report v2: mandatory photo (verified to exist in storage), server-side routing, basic throttle
-- ---------------------------------------------------------------------------
drop function public.submit_report(double precision, double precision, text, integer, text, text, text, text[], text, integer, text, text, text, text, jsonb);

create function public.submit_report(
  p_lat double precision, p_lng double precision, p_location_source text, p_accuracy_m integer,
  p_description text, p_lang text, p_category text, p_urgency_hints text[], p_landmark text,
  p_severity integer, p_photo_path text, p_reporter_id text,
  p_address_source text default null, p_address_formatted text default null, p_address_components jsonb default null,
  p_photo_meta jsonb default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_case_id text;
  v_tries   integer := 0;
  v_obj     record;
  v_match   jsonb;
  v_meta    jsonb;
begin
  -- New complaints require a photo that really exists in the private bucket, is a JPEG and is small enough.
  if p_photo_path is null or length(trim(p_photo_path)) = 0 then
    raise exception 'A live photo is required to submit a complaint' using errcode = 'check_violation';
  end if;
  if p_photo_path !~ '^incoming/[A-Za-z0-9._-]{8,100}\.jpe?g$' then
    raise exception 'Invalid photo path' using errcode = 'check_violation';
  end if;
  select name, metadata into v_obj from storage.objects where bucket_id = 'report-photos' and name = p_photo_path;
  if not found then raise exception 'Photo not found in storage: upload it first' using errcode = 'check_violation'; end if;
  if coalesce(v_obj.metadata ->> 'mimetype', '') <> 'image/jpeg' then raise exception 'Photo must be a JPEG' using errcode = 'check_violation'; end if;
  if coalesce((v_obj.metadata ->> 'size')::bigint, 0) > 1572864 or coalesce((v_obj.metadata ->> 'size')::bigint, 0) <= 0 then
    raise exception 'Photo must be between 1 byte and 1.5 MB' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.reports where photo_path = p_photo_path) then
    raise exception 'This photo was already used for another report' using errcode = 'check_violation';
  end if;

  -- Basic throttle per (client supplied) reporter id. A determined attacker can vary the id, so real rate limiting
  -- must also be done at the API gateway / edge; this only stops accidental floods.
  if (select count(*) from public.reports where reporter_id = p_reporter_id and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'Too many reports from this reporter; please wait a few minutes' using errcode = 'check_violation';
  end if;

  v_match := public.match_responsible(p_category, p_lat, p_lng);
  v_meta := case when p_photo_meta is null then null else jsonb_build_object(
      'source', 'browser_camera_client_claim',                          -- fixed server-side: the client cannot assert authenticity
      'capturedAtClient', left(coalesce(p_photo_meta ->> 'capturedAtClient', ''), 40),
      'width', coalesce((p_photo_meta ->> 'width')::int, 0), 'height', coalesce((p_photo_meta ->> 'height')::int, 0), 'bytes', coalesce((p_photo_meta ->> 'bytes')::int, 0)) end;

  loop
    v_case_id := 'JR-' || to_char(now() at time zone 'utc', 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    begin
      insert into public.reports (
        case_id, lat, lng, location_source, accuracy_m, description, lang, category, urgency_hints, landmark,
        severity, photo_path, reporter_id, address_source, address_formatted, address_components,
        match_result, matched_department, matched_officer_id, match_kind, photo_meta
      ) values (
        v_case_id, p_lat, p_lng, p_location_source, p_accuracy_m, p_description, p_lang, p_category,
        coalesce(p_urgency_hints, '{}'), p_landmark, p_severity, p_photo_path, p_reporter_id,
        p_address_source, nullif(trim(p_address_formatted), ''), p_address_components,
        v_match, v_match ->> 'department', nullif(v_match #>> '{officer,officer_id}', '')::uuid, v_match ->> 'kind', v_meta
      );
      return v_case_id;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries >= 5 then raise exception 'could not allocate a case id'; end if;
    end;
  end loop;
end;
$$;

-- Public tracking: own report only, generic timeline (no staff names, no other citizens' case ids), no staff data.
drop function public.track_case(text);
create function public.track_case(p_case_id text)
returns table (
  case_id text, created_at timestamptz, description text, category text, address_formatted text,
  lat double precision, lng double precision, status text, verified boolean, events jsonb, match_result jsonb
)
language sql stable security definer set search_path = public as $$
  select r.case_id, r.created_at, r.description, r.category, r.address_formatted, r.lat, r.lng, c.status,
         (c.status = 'closed' and c.verified_by is not null),
         coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'text', case e.type
                      when 'reported' then 'Report received'
                      when 'linked' then 'A nearby report about the same issue was grouped with this one'
                      when 'assigned' then 'Assigned to a municipal operator'
                      when 'evidence' then 'Inspection or repair evidence recorded'
                      else e.text end) order by e.at, e.id)
                   from public.case_events e where e.report_id = r.id), '[]'::jsonb),
         r.match_result
  from public.reports r join public.cases c on c.report_id = r.id
  where r.case_id = upper(trim(p_case_id));
$$;

-- ---------------------------------------------------------------------------
-- 8. Case assignment and role-scoped access
-- ---------------------------------------------------------------------------
alter table public.cases
  add column assigned_to      uuid references auth.users (id),
  add column assigned_by      uuid references auth.users (id),
  add column assigned_by_role text check (assigned_by_role is null or assigned_by_role in ('operator', 'administrator')),
  add column assigned_at      timestamptz;

-- Assignment is only possible through the two functions below (assignee / assigned_* are no longer directly writable).
create or replace function public.enforce_case_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_has_before boolean;
begin
  new.updated_at := now();

  if new.status is distinct from old.status then
    if (old.status, new.status) not in (
      ('reported', 'investigating'), ('investigating', 'inspected'), ('inspected', 'repaired'),
      ('inspected', 'not_confirmed'), ('repaired', 'closed')
    ) then
      raise exception 'Invalid status transition: % -> %', old.status, new.status using errcode = 'check_violation';
    end if;
    if new.status in ('inspected', 'not_confirmed') and not exists (select 1 from public.case_evidence where report_id = new.report_id and kind = 'inspection_note') then
      raise exception 'Add an inspection note before recording the inspection outcome' using errcode = 'check_violation';
    end if;
    if new.status = 'repaired' and not exists (select 1 from public.case_evidence where report_id = new.report_id and kind = 'after') then
      raise exception 'Attach an after-repair photo before marking repaired' using errcode = 'check_violation';
    end if;
    if new.status = 'closed' then
      if new.verified_by is null or length(trim(new.verified_by)) = 0 then
        raise exception 'Closure needs a named verifier' using errcode = 'check_violation';
      end if;
      select (r.photo_path is not null) or exists (select 1 from public.case_evidence e where e.report_id = r.id and e.kind = 'before')
        into v_has_before from public.reports r where r.id = new.report_id;
      if not coalesce(v_has_before, false) then raise exception 'Closure needs before-repair evidence' using errcode = 'check_violation'; end if;
      if not exists (select 1 from public.case_evidence where report_id = new.report_id and kind = 'inspection_note') then
        raise exception 'Closure needs an inspection note' using errcode = 'check_violation';
      end if;
      if not exists (select 1 from public.case_evidence where report_id = new.report_id and kind = 'after') then
        raise exception 'Closure needs an after-repair photo' using errcode = 'check_violation';
      end if;
    end if;
    insert into public.case_events (report_id, actor, type, text)
    values (new.report_id,
            case when new.status = 'closed' then trim(new.verified_by) else public.current_actor() end,
            'status',
            case when new.status = 'closed' then 'Status: closed (evidence checklist complete)' else 'Status: ' || replace(new.status, '_', ' ') end);
  end if;

  if new.verified_by is distinct from old.verified_by and new.status <> 'closed' then
    raise exception 'verified_by can only be set when closing a case' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create function public.claim_case(p_report uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.current_role_name();
  v_name text := public.current_actor();
begin
  if v_role = 'citizen' then raise exception 'Operator or administrator access required' using errcode = 'insufficient_privilege'; end if;
  update public.cases set assigned_to = auth.uid(), assignee = v_name, assigned_by = auth.uid(), assigned_by_role = v_role, assigned_at = now()
   where report_id = p_report and assigned_to is null;
  if not found then raise exception 'Case not found or already assigned' using errcode = 'check_violation'; end if;
  insert into public.case_events (report_id, actor, type, text)
  values (p_report, v_name, 'assigned', 'Assigned to ' || v_name || ' by ' || v_name || ' (' || v_role || ')' ||
          case when v_role = 'administrator' then ' - administrator-confirmed' else ' - self-assigned, not administrator-confirmed' end);
  perform public.write_audit('case.claim', p_report::text, jsonb_build_object('to', v_name));
end;
$$;

create function public.assign_case(p_report uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_target text;
  v_by text := public.current_actor();
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode = 'insufficient_privilege'; end if;
  select display_name into v_target from public.user_roles where user_id = p_user;
  if v_target is null then raise exception 'Assignee must be an operator or administrator' using errcode = 'check_violation'; end if;
  update public.cases set assigned_to = p_user, assignee = v_target, assigned_by = auth.uid(), assigned_by_role = 'administrator', assigned_at = now()
   where report_id = p_report;
  if not found then raise exception 'Case not found' using errcode = 'no_data_found'; end if;
  insert into public.case_events (report_id, actor, type, text)
  values (p_report, v_by, 'assigned', 'Assigned to ' || v_target || ' by ' || v_by || ' (administrator) - administrator-confirmed');
  perform public.write_audit('case.assign', p_report::text, jsonb_build_object('to', v_target));
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Row level security
-- ---------------------------------------------------------------------------
alter table public.user_roles enable row level security;
alter table public.audit_log  enable row level security;
alter table public.zones      enable row level security;
alter table public.officers   enable row level security;

drop policy reports_operator_read   on public.reports;
drop policy cases_operator_read     on public.cases;
drop policy cases_operator_update   on public.cases;
drop policy events_operator_read    on public.case_events;
drop policy evidence_operator_read  on public.case_evidence;
drop policy evidence_operator_insert on public.case_evidence;

-- A staff member may see a case if they are an administrator, or an operator and the case is unassigned or theirs.
create function public.can_see_case(p_report uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_operator() and exists (
    select 1 from public.cases c where c.report_id = p_report and (c.assigned_to is null or c.assigned_to = auth.uid())));
$$;
create function public.can_work_case(p_report uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_operator() and exists (select 1 from public.cases c where c.report_id = p_report and c.assigned_to = auth.uid()));
$$;

create policy reports_staff_read on public.reports for select to authenticated using (public.can_see_case(id));
create policy cases_staff_read   on public.cases   for select to authenticated using (public.can_see_case(report_id));
create policy cases_staff_update on public.cases   for update to authenticated using (public.can_work_case(report_id)) with check (public.can_work_case(report_id));
create policy events_staff_read  on public.case_events for select to authenticated using (public.can_see_case(report_id));
create policy evidence_staff_read   on public.case_evidence for select to authenticated using (public.can_see_case(report_id));
create policy evidence_staff_insert on public.case_evidence for insert to authenticated with check (public.can_work_case(report_id));

create policy roles_self_or_admin on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy audit_admin_read    on public.audit_log  for select to authenticated using (public.is_admin());
create policy zones_staff_read    on public.zones      for select to authenticated using (public.is_operator());
create policy zones_admin_insert  on public.zones      for insert to authenticated with check (public.is_admin());
create policy zones_admin_update  on public.zones      for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy zones_admin_delete  on public.zones      for delete to authenticated using (public.is_admin());
create policy officers_staff_read   on public.officers for select to authenticated using (public.is_operator());
create policy officers_admin_insert on public.officers for insert to authenticated with check (public.is_admin());
create policy officers_admin_update on public.officers for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 10. Grants (least privilege)
-- ---------------------------------------------------------------------------
revoke all on public.user_roles, public.audit_log, public.zones, public.officers from anon, authenticated;
revoke update (assignee) on public.cases from authenticated;           -- assignment goes through claim_case / assign_case
-- (status, verified_by) stay updatable; RLS limits that to cases the actor may work on

grant select on public.user_roles, public.audit_log, public.zones, public.officers to authenticated;
grant insert (full_name, designation, department, assigned_zones, assigned_wards, official_phone, official_email, office_name, office_address, source_url, source_type, last_checked_at, assignment_notes) on public.officers to authenticated;
grant update (full_name, designation, department, assigned_zones, assigned_wards, official_phone, official_email, office_name, office_address, source_url, source_type, last_checked_at, assignment_notes) on public.officers to authenticated;
grant insert (zone_id, name, boundary, notes), update (name, boundary, notes) on public.zones to authenticated;
grant delete on public.zones to authenticated;

revoke all on function public.submit_report(double precision, double precision, text, integer, text, text, text, text[], text, integer, text, text, text, text, jsonb, jsonb) from public;
revoke all on function public.track_case(text) from public;
revoke all on function public.match_responsible(text, double precision, double precision, date) from public;
revoke all on function public.is_admin(), public.current_role_name(), public.can_see_case(uuid), public.can_work_case(uuid), public.point_in_ring(double precision, double precision, jsonb) from public;
revoke all on function public.set_user_role(uuid, text, text), public.verify_officer(uuid, text, text), public.deactivate_officer(uuid), public.reactivate_officer(uuid),
  public.mark_officer_needs_review(uuid), public.claim_case(uuid), public.assign_case(uuid, uuid) from public;

grant execute on function public.submit_report(double precision, double precision, text, integer, text, text, text, text[], text, integer, text, text, text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.track_case(text) to anon, authenticated;
grant execute on function public.match_responsible(text, double precision, double precision, date) to anon, authenticated;
grant execute on function public.is_admin(), public.current_role_name(), public.can_see_case(uuid), public.can_work_case(uuid), public.point_in_ring(double precision, double precision, jsonb) to anon, authenticated;
grant execute on function public.set_user_role(uuid, text, text), public.verify_officer(uuid, text, text), public.deactivate_officer(uuid), public.reactivate_officer(uuid),
  public.mark_officer_needs_review(uuid), public.claim_case(uuid), public.assign_case(uuid, uuid) to authenticated;
