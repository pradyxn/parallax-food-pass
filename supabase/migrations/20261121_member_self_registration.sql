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

-- Preserve section as a separate field for CSV imports while retaining legacy Google Forms support.
create or replace function public.sync_google_registrations(
    p_records jsonb,
    p_suppress_emails boolean default false
  )
  returns table (
    row_number integer,
    outcome text,
    attendee_id uuid,
    pass_token uuid,
    email text,
    email_changed boolean
  )
  language plpgsql
  security invoker
  set search_path = public, pg_temp
  as $$
  declare
    v_record jsonb;
    v_ordinality bigint;
    v_row_number integer;
    v_name text;
    v_roll_number text;
    v_email text;
    v_branch text;
    v_section text;
    v_raw_preference text;
    v_preference text;
    v_previous_email text;
    v_was_inserted boolean;
    v_id uuid;
    v_pass_token uuid;
    v_email_changed boolean;
  begin
    if p_records is null or jsonb_typeof(p_records) <> 'array' then
      raise exception 'p_records must be a JSON array';
    end if;
    perform set_config('parallax.suppress_registration_email', p_suppress_emails::text, true);

    for v_record, v_ordinality in
      select item.value, item.ordinality
      from jsonb_array_elements(p_records) with ordinality as item(value, ordinality)
    loop
      v_name := nullif(trim(v_record ->> 'name'), '');
      v_roll_number := upper(nullif(trim(v_record ->> 'roll_number'), ''));
      v_email := nullif(lower(trim(v_record ->> 'email')), '');
      v_branch := nullif(trim(v_record ->> 'branch'), '');
      v_section := nullif(trim(v_record ->> 'section'), '');
      v_raw_preference := regexp_replace(
        upper(trim(coalesce(v_record ->> 'preference', ''))),
        '[^A-Z0-9]+',
        '_',
        'g'
      );
      v_raw_preference := trim(both '_' from v_raw_preference);
      v_preference := case
        when v_raw_preference in ('VEG', 'VEGETARIAN') then 'VEG'
        when v_raw_preference in ('NON_VEG', 'NONVEG', 'NON_VEGETARIAN', 'NONVEGETARIAN') then 'NON_VEG'
        else null
      end;
      v_row_number := coalesce(nullif(v_record ->> 'rowNumber', '')::integer, v_ordinality::integer + 1);

      if length(coalesce(v_name, '')) < 2
        or v_roll_number is null
        or v_preference is null then
        raise exception 'Invalid registration at row %', v_row_number;
      end if;
      if v_email is not null and v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        raise exception 'Invalid email at row %', v_row_number;
      end if;

      select a.email into v_previous_email
      from public.attendees as a
      where lower(trim(a.roll_number)) = lower(v_roll_number)
      for update;
      v_email_changed := v_email is not null
        and lower(trim(v_email)) is distinct from lower(trim(v_previous_email));

      insert into public.attendees (name, roll_number, email, branch, section, preference, source)
      values (v_name, v_roll_number, v_email, v_branch, v_section, v_preference, 'IMPORT')
      on conflict ((lower(trim(roll_number))))
        where roll_number is not null and trim(roll_number) <> ''
      do update set
        name = excluded.name,
        email = coalesce(excluded.email, attendees.email),
        branch = coalesce(excluded.branch, attendees.branch),
        section = coalesce(excluded.section, attendees.section),
        preference = excluded.preference
      where attendees.name is distinct from excluded.name
        or (excluded.email is not null and attendees.email is distinct from excluded.email)
        or (excluded.branch is not null and attendees.branch is distinct from excluded.branch)
        or (excluded.section is not null and attendees.section is distinct from excluded.section)
        or attendees.preference is distinct from excluded.preference
      returning attendees.id, attendees.pass_token, (xmax = 0)
      into v_id, v_pass_token, v_was_inserted;

      if found then
        row_number := v_row_number;
        outcome := case when v_was_inserted then 'inserted' else 'updated' end;
        attendee_id := v_id;
        pass_token := v_pass_token;
        email := v_email;
        email_changed := v_email_changed;
        return next;
      else
        select a.id, a.pass_token, a.email
        into v_id, v_pass_token, v_email
        from public.attendees as a
        where lower(trim(a.roll_number)) = lower(v_roll_number)
        for update;
        if not found then
          raise exception 'Could not find synchronized attendee at row %', v_row_number;
        end if;
        row_number := v_row_number;
        outcome := 'unchanged';
        attendee_id := v_id;
        pass_token := v_pass_token;
        email := v_email;
        email_changed := false;
        return next;
      end if;
    end loop;
  end;
  $$;

  revoke all on function public.sync_google_registrations(jsonb, boolean) from public, anon, authenticated;
  grant execute on function public.sync_google_registrations(jsonb, boolean) to service_role;
