  -- Additive Google registration sync, email delivery, and sync metrics.
  alter table public.attendees add column if not exists email text;

  create table if not exists public.registration_sync_settings (
    id smallint primary key default 1 check (id = 1),
    automatic_email_enabled boolean not null default false,
    email_on_existing_change boolean not null default false,
    updated_at timestamptz not null default now()
  );

  insert into public.registration_sync_settings (id)
  values (1)
  on conflict (id) do nothing;

  create table if not exists public.registration_email_outbox (
    id uuid primary key default gen_random_uuid(),
    attendee_id uuid not null references public.attendees(id),
    email text not null,
    status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
    attempts integer not null default 0 check (attempts >= 0),
    resend_id text,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    sent_at timestamptz,
    unique (attendee_id, email)
  );

  alter table public.registration_email_outbox
    drop constraint if exists registration_email_outbox_status_check;
  alter table public.registration_email_outbox
    add constraint registration_email_outbox_status_check
    check (status in ('pending', 'sending', 'sent', 'failed'));

  create index if not exists registration_email_outbox_status_idx
    on public.registration_email_outbox (status, created_at);

  create table if not exists public.google_sync_batches (
    sync_id text not null,
    batch_index integer not null check (batch_index >= 0),
    batch_count integer not null check (batch_count > 0),
    request_hash text not null,
    inserted_count integer not null default 0,
    updated_count integer not null default 0,
    unchanged_count integer not null default 0,
    rejected_count integer not null default 0,
    errors jsonb not null default '[]'::jsonb,
    response jsonb not null,
    completed_at timestamptz not null default now(),
    primary key (sync_id, batch_index)
  );

  create index if not exists google_sync_batches_completed_at_idx
    on public.google_sync_batches (completed_at desc);

  create table if not exists public.google_sync_state (
    id smallint primary key default 1 check (id = 1),
    last_sync_id text,
    last_successful_sync_at timestamptz,
    new_registrations_since_last_sync integer not null default 0,
    synchronization_errors integer not null default 0,
    updated_at timestamptz not null default now()
  );

  alter table public.registration_sync_settings enable row level security;
  alter table public.registration_email_outbox enable row level security;
  alter table public.google_sync_batches enable row level security;
  alter table public.google_sync_state enable row level security;

  grant select, insert, update on public.registration_sync_settings to service_role;
  grant select, insert, update on public.registration_email_outbox to service_role;
  grant select, insert, update on public.google_sync_batches to service_role;
  grant select, insert, update on public.google_sync_state to service_role;

  create or replace function public.queue_registration_pass_email()
  returns trigger
  language plpgsql
  security invoker
  set search_path = public, pg_temp
  as $$
  declare
    v_auto_enabled boolean;
    v_email_change_enabled boolean;
  begin
    if current_setting('parallax.suppress_registration_email', true) = 'true' then
      return new;
    end if;

    select automatic_email_enabled, email_on_existing_change
    into v_auto_enabled, v_email_change_enabled
    from public.registration_sync_settings
    where id = 1;

    if not coalesce(v_auto_enabled, false) or nullif(trim(new.email), '') is null then
      return new;
    end if;

    if tg_op = 'INSERT' then
      insert into public.registration_email_outbox (attendee_id, email)
      values (new.id, lower(trim(new.email)))
      on conflict (attendee_id, email) do nothing;
    elsif v_email_change_enabled
      and lower(trim(new.email)) is distinct from lower(trim(old.email)) then
      insert into public.registration_email_outbox (attendee_id, email)
      values (new.id, lower(trim(new.email)))
      on conflict (attendee_id, email) do nothing;
    end if;
    return new;
  end;
  $$;

  drop trigger if exists attendees_queue_pass_email_insert on public.attendees;
  create trigger attendees_queue_pass_email_insert
  after insert on public.attendees
  for each row execute function public.queue_registration_pass_email();

  drop trigger if exists attendees_queue_pass_email_update on public.attendees;
  create trigger attendees_queue_pass_email_update
  after update of email on public.attendees
  for each row execute function public.queue_registration_pass_email();

  drop function if exists public.sync_google_registrations(jsonb);

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

      insert into public.attendees (name, roll_number, email, branch, preference, source)
      values (v_name, v_roll_number, v_email, v_branch, v_preference, 'IMPORT')
      on conflict ((lower(trim(roll_number))))
        where roll_number is not null and trim(roll_number) <> ''
      do update set
        name = excluded.name,
        email = coalesce(excluded.email, attendees.email),
        branch = coalesce(excluded.branch, attendees.branch),
        preference = excluded.preference
      where attendees.name is distinct from excluded.name
        or (excluded.email is not null and attendees.email is distinct from excluded.email)
        or (excluded.branch is not null and attendees.branch is distinct from excluded.branch)
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

  create or replace function public.claim_registration_emails(
    p_statuses text[],
    p_attendee_ids uuid[] default null,
    p_created_after timestamptz default null,
    p_limit integer default 50
  )
  returns table (id uuid, attendee_id uuid, email text, attempts integer)
  language plpgsql
  security invoker
  set search_path = public, pg_temp
  as $$
  begin
    if p_statuses is null or not (p_statuses <@ array['pending', 'failed']::text[]) then
      raise exception 'p_statuses may contain only pending and failed';
    end if;

    return query
    with candidates as (
      select o.id
      from public.registration_email_outbox as o
      where (
        o.status = any(p_statuses)
        or (o.status = 'sending' and o.updated_at < now() - interval '10 minutes')
      )
        and (p_attendee_ids is null or o.attendee_id = any(p_attendee_ids))
        and (p_created_after is null or o.created_at >= p_created_after)
      order by o.created_at
      for update skip locked
      limit greatest(1, least(coalesce(p_limit, 50), 100))
    )
    update public.registration_email_outbox as o
    set status = 'sending',
        attempts = o.attempts + 1,
        last_error = null,
        updated_at = now()
    from candidates as c
    where o.id = c.id
    returning o.id, o.attendee_id, o.email, o.attempts;
  end;
  $$;

  revoke all on function public.claim_registration_emails(text[], uuid[], timestamptz, integer) from public, anon, authenticated;
  grant execute on function public.claim_registration_emails(text[], uuid[], timestamptz, integer) to service_role;
