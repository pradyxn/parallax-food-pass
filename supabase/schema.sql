-- Parallax Food Pass — Supabase schema
-- Run this once in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.attendees (
  id uuid primary key default gen_random_uuid(),
  pass_token uuid not null unique default gen_random_uuid(),
  name text not null,
  roll_number text,
  email text,
  branch text,
  preference text not null check (preference in ('VEG', 'NON_VEG')),
  source text not null default 'IMPORT' check (source in ('IMPORT', 'WALK_IN', 'MANUAL')),
  checked_in_at timestamptz,
  meal_reserved_at timestamptz,
  meal_reservation_token uuid,
  meal_collected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prevent duplicate roll numbers while allowing guests without a roll number.
create unique index if not exists attendees_roll_number_unique
  on public.attendees (lower(trim(roll_number)))
  where roll_number is not null and trim(roll_number) <> '';

create index if not exists attendees_created_at_idx on public.attendees (created_at desc);
create index if not exists attendees_preference_idx on public.attendees (preference);
create index if not exists attendees_checked_in_at_idx on public.attendees (checked_in_at);
create index if not exists attendees_meal_reserved_at_idx
  on public.attendees (meal_reserved_at)
  where meal_reserved_at is not null;

-- The app accesses this table only from server routes using the service-role key.
-- RLS remains enabled and there are intentionally no anon/authenticated policies.
alter table public.attendees enable row level security;
grant select, insert, update on table public.attendees to service_role;

create or replace function public.set_attendees_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists attendees_updated_at_trigger on public.attendees;
create trigger attendees_updated_at_trigger
before update on public.attendees
for each row execute function public.set_attendees_updated_at();
