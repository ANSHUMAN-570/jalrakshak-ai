-- JalRakshak AI: private bucket for complaint photos and operator evidence, with access policies (Supabase Storage)
--
-- Layout:  incoming/<random>.jpg        citizen live photos (uploaded before submit_report is called)
--          evidence/<report uuid>/...   operator before/after evidence
--
-- Limits are enforced by the bucket itself (JPEG only, 1.5 MB) AND re-checked by submit_report() against storage.objects.
-- Citizens may upload but never read; staff may read only photos of cases they can see; nobody can update or delete via the API.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', false, 1572864, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy report_photos_citizen_upload on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'report-photos' and name ~ '^incoming/[A-Za-z0-9._-]{8,100}\.jpe?g$');

create policy report_photos_staff_evidence_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'report-photos' and name ~ '^evidence/[0-9a-f-]{36}/[A-Za-z0-9._-]{4,100}\.jpe?g$'
              and public.can_work_case(((storage.foldername(name))[2])::uuid));

create policy report_photos_staff_read on storage.objects
  for select to authenticated
  using (bucket_id = 'report-photos' and (
    public.is_admin()
    or (public.is_operator() and (
          exists (select 1 from public.reports r where r.photo_path = storage.objects.name and public.can_see_case(r.id))
       or exists (select 1 from public.case_evidence e where e.photo_path = storage.objects.name and public.can_see_case(e.report_id))))));
