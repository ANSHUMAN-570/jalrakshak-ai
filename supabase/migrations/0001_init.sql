-- JalRakshak AI: initial schema (PostgreSQL / Supabase)
--
-- Design:
--   * Citizens are anonymous. They can ONLY call submit_report() and track_case(); they cannot read tables.
--   * Operators are Supabase Auth users listed in public.operators. They can read everything and
--     update case state, but status changes are validated by a trigger (valid transitions + closure evidence).
--   * The audit trail (case_events) is written only by triggers, so actor names cannot be forged.
--   * Incident clustering (duplicate grouping) stays in the client, as in the prototype; every report gets a
--     cases row and the client treats the earliest report of a cluster as the incident's root.
--
-- Apply: Supabase dashboard -> SQL editor -> paste -> run (or `supabase db push`).
-- Uses only built-in Postgres 13+ features (gen_random_uuid), no extensions.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.operators (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  created_at   timestamptz not null default now()
);

create table public.reports (
  id                 uuid primary key default gen_random_uuid(),
  case_id            text not null unique,
  created_at         timestamptz not null default now(),
  lat                double precision not null check (lat between -90 and 90),
  lng                double precision not null check (lng between -180 and 180),
  location_source    text not null check (location_source in ('gps', 'map_pin')),
  accuracy_m         integer check (accuracy_m is null or accuracy_m between 0 and 100000),
  description        text not null check (length(trim(description)) between 10 and 1000),
  lang               text not null check (lang in ('en', 'hi')),
  category           text not null check (category in ('burst_main', 'pipe_leak', 'meter_valve', 'contamination', 'overflow', 'other')),
  urgency_hints      text[] not null default '{}' check (cardinality(urgency_hints) <= 10),
  landmark           text check (landmark is null or length(landmark) <= 120),
  severity           integer not null check (severity between 0 and 100),
  photo_path         text,                      -- object path in the private 'report-photos' bucket
  reporter_id        text not null check (length(reporter_id) between 1 and 64),
  -- address (all optional; reports created before addresses existed simply have nulls)
  address_source     text check (address_source is null or address_source in ('auto', 'manual')),
  address_formatted  text check (address_formatted is null or length(address_formatted) <= 300),
  address_components jsonb check (address_components is null or jsonb_typeof(address_components) = 'object'),
  demo               boolean not null default false,
  check (address_source is null or address_formatted is not null or address_components is not null)
);
create index reports_created_at_idx on public.reports (created_at desc);
create index reports_lat_lng_idx on public.reports (lat, lng);

create table public.cases (
  report_id   uuid primary key references public.reports (id) on delete cascade,
  status      text not null default 'reported'
              check (status in ('reported', 'investigating', 'inspected', 'repaired', 'closed', 'not_confirmed')),
  assignee    text check (assignee is null or length(assignee) <= 120),
  verified_by text check (verified_by is null or length(verified_by) <= 120),
  updated_at  timestamptz not null default now()
);

create table public.case_evidence (
  id         bigint generated always as identity primary key,
  report_id  uuid not null references public.reports (id) on delete cascade,
  at         timestamptz not null default now(),
  actor      text not null,
  kind       text not null check (kind in ('before', 'after', 'inspection_note')),
  photo_path text,
  note       text check (note is null or length(note) <= 2000),
  check (
    (kind = 'inspection_note' and note is not null and length(trim(note)) > 0)
    or (kind <> 'inspection_note' and photo_path is not null)
  )
);
create index case_evidence_report_idx on public.case_evidence (report_id);

create table public.case_events (
  id        bigint generated always as identity primary key,
  report_id uuid not null references public.reports (id) on delete cascade,
  at        timestamptz not null default now(),
  actor     text not null,
  type      text not null check (type in ('reported', 'linked', 'assigned', 'status', 'evidence')),
  text      text not null
);
create index case_events_report_idx on public.case_events (report_id, at);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public.is_operator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.operators where user_id = auth.uid());
$$;

create function public.current_actor() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from public.operators where user_id = auth.uid()), 'system');
$$;

-- ---------------------------------------------------------------------------
-- Public API for citizens (the ONLY write path for anonymous users)
-- ---------------------------------------------------------------------------
create function public.submit_report(
  p_lat double precision, p_lng double precision, p_location_source text, p_accuracy_m integer,
  p_description text, p_lang text, p_category text, p_urgency_hints text[], p_landmark text,
  p_severity integer, p_photo_path text, p_reporter_id text,
  p_address_source text default null, p_address_formatted text default null, p_address_components jsonb default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_case_id text;
  v_tries   integer := 0;
begin
  loop
    v_case_id := 'JR-' || to_char(now() at time zone 'utc', 'YYYYMMDD') || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    begin
      insert into public.reports (
        case_id, lat, lng, location_source, accuracy_m, description, lang, category, urgency_hints, landmark,
        severity, photo_path, reporter_id, address_source, address_formatted, address_components
      ) values (
        v_case_id, p_lat, p_lng, p_location_source, p_accuracy_m, p_description, p_lang, p_category,
        coalesce(p_urgency_hints, '{}'), p_landmark, p_severity, p_photo_path, p_reporter_id,
        p_address_source, nullif(trim(p_address_formatted), ''), p_address_components
      );
      return v_case_id;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries >= 5 then raise exception 'could not allocate a case id'; end if;
    end;
  end loop;
end;
$$;

-- Public, privacy-limited lookup: returns only the caller's own report (they must know the case id).
create function public.track_case(p_case_id text)
returns table (
  case_id text, created_at timestamptz, description text, category text, address_formatted text,
  lat double precision, lng double precision, status text, verified boolean, events jsonb
)
language sql stable security definer set search_path = public as $$
  select r.case_id, r.created_at, r.description, r.category, r.address_formatted, r.lat, r.lng, c.status,
         (c.status = 'closed' and c.verified_by is not null) as verified,
         coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'text', e.text) order by e.at, e.id)
                   from public.case_events e where e.report_id = r.id), '[]'::jsonb)
  from public.reports r
  join public.cases c on c.report_id = r.id
  where r.case_id = upper(trim(p_case_id));
$$;

-- ---------------------------------------------------------------------------
-- Triggers: case row + audit trail + status rules
-- ---------------------------------------------------------------------------
create function public.on_report_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.cases (report_id) values (new.id);
  insert into public.case_events (report_id, actor, type, text)
  values (new.id, 'system', 'reported', 'Report ' || new.case_id || ' received');
  return new;
end;
$$;
create trigger reports_after_insert after insert on public.reports
  for each row execute function public.on_report_insert();

create function public.on_evidence_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.case_events (report_id, actor, type, text)
  values (new.report_id, new.actor, 'evidence', 'Evidence added: ' || replace(new.kind, '_', ' '));
  return new;
end;
$$;
create trigger evidence_after_insert after insert on public.case_evidence
  for each row execute function public.on_evidence_insert();

-- Evidence actor is taken from the signed-in operator, never from the client.
create function public.evidence_set_actor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.actor := public.current_actor();
  return new;
end;
$$;
create trigger evidence_before_insert before insert on public.case_evidence
  for each row execute function public.evidence_set_actor();

create function public.enforce_case_update() returns trigger
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

    if new.status in ('inspected', 'not_confirmed') and not exists (
      select 1 from public.case_evidence where report_id = new.report_id and kind = 'inspection_note'
    ) then
      raise exception 'Add an inspection note before recording the inspection outcome' using errcode = 'check_violation';
    end if;

    if new.status = 'repaired' and not exists (
      select 1 from public.case_evidence where report_id = new.report_id and kind = 'after'
    ) then
      raise exception 'Attach an after-repair photo before marking repaired' using errcode = 'check_violation';
    end if;

    if new.status = 'closed' then
      if new.verified_by is null or length(trim(new.verified_by)) = 0 then
        raise exception 'Closure needs a named verifier' using errcode = 'check_violation';
      end if;
      -- before evidence: this report's own photo or an uploaded 'before' photo
      -- (the prototype UI also accepts a photo from any grouped report; here grouping is client-side)
      select (r.photo_path is not null) or exists (
               select 1 from public.case_evidence e where e.report_id = r.id and e.kind = 'before')
        into v_has_before from public.reports r where r.id = new.report_id;
      if not coalesce(v_has_before, false) then
        raise exception 'Closure needs before-repair evidence' using errcode = 'check_violation';
      end if;
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
            case when new.status = 'closed' then 'Status: closed (evidence checklist complete)'
                 else 'Status: ' || replace(new.status, '_', ' ') end);
  end if;

  if new.assignee is distinct from old.assignee and new.assignee is not null then
    insert into public.case_events (report_id, actor, type, text)
    values (new.report_id, public.current_actor(), 'assigned', 'Assigned to ' || new.assignee);
  end if;

  -- verified_by may only be set together with closing
  if new.verified_by is distinct from old.verified_by and new.status <> 'closed' then
    raise exception 'verified_by can only be set when closing a case' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger cases_before_update before update on public.cases
  for each row execute function public.enforce_case_update();

-- ---------------------------------------------------------------------------
-- Row level security and grants
-- ---------------------------------------------------------------------------
alter table public.operators     enable row level security;
alter table public.reports       enable row level security;
alter table public.cases         enable row level security;
alter table public.case_evidence enable row level security;
alter table public.case_events   enable row level security;

revoke all on public.operators, public.reports, public.cases, public.case_evidence, public.case_events from anon, authenticated;
revoke all on function public.submit_report(double precision, double precision, text, integer, text, text, text, text[], text, integer, text, text, text, text, jsonb) from public;
revoke all on function public.track_case(text) from public;
revoke all on function public.is_operator(), public.current_actor() from public;

grant execute on function public.submit_report(double precision, double precision, text, integer, text, text, text, text[], text, integer, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.track_case(text) to anon, authenticated;
grant execute on function public.is_operator(), public.current_actor() to authenticated;

grant select on public.operators, public.reports, public.cases, public.case_events, public.case_evidence to authenticated;
grant update (status, assignee, verified_by) on public.cases to authenticated;
grant insert (report_id, kind, photo_path, note) on public.case_evidence to authenticated;

create policy operators_self_read   on public.operators     for select to authenticated using (user_id = auth.uid());
create policy reports_operator_read on public.reports       for select to authenticated using (public.is_operator());
create policy cases_operator_read   on public.cases         for select to authenticated using (public.is_operator());
create policy cases_operator_update on public.cases         for update to authenticated using (public.is_operator()) with check (public.is_operator());
create policy events_operator_read  on public.case_events   for select to authenticated using (public.is_operator());
create policy evidence_operator_read   on public.case_evidence for select to authenticated using (public.is_operator());
create policy evidence_operator_insert on public.case_evidence for insert to authenticated with check (public.is_operator());

-- No insert/update/delete policies exist for anon, and none for deleting anything: records are append-only
-- for operators (case state is updated, evidence and events are never edited or removed through the API).
-- To make someone an operator (run as the project owner after they sign up):
--   insert into public.operators (user_id, display_name) values ('<auth user uuid>', 'Name shown in the audit trail');
