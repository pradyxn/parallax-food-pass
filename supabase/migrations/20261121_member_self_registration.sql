-- Add separate section storage and identify public self-registrations.
-- Existing attendee rows, pass tokens, and check-in data are preserved.
alter table public.attendees
  add column if not exists section text;

alter table public.attendees
  drop constraint if exists attendees_source_check;

alter table public.attendees
  add constraint attendees_source_check
  check (source in ('IMPORT', 'WALK_IN', 'MANUAL', 'SELF_REGISTERED'));

create index if not exists attendees_section_idx
  on public.attendees (section)
  where section is not null and trim(section) <> '';
