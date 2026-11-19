-- Non-destructive support for reserving a meal while staff hand it over.
-- Reservations expire in the application and are not recorded as meal collection.
alter table public.attendees
  add column if not exists meal_reserved_at timestamptz,
  add column if not exists meal_reservation_token uuid;

create index if not exists attendees_meal_reserved_at_idx
  on public.attendees (meal_reserved_at)
  where meal_reserved_at is not null;

-- Keep roll-number uniqueness enforced even when registrations race across devices.
create unique index if not exists attendees_roll_number_unique
  on public.attendees (lower(trim(roll_number)))
  where roll_number is not null and trim(roll_number) <> '';
