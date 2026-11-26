create table if not exists public.app_bookings (
  id text primary key,
  booking_date date not null,
  username text not null,
  status text not null check (status in ('pending', 'confirmed', 'cancelled', 'rejected', 'completed')),
  record jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists app_bookings_user_date_idx
  on public.app_bookings (username, booking_date);

create index if not exists app_bookings_status_date_idx
  on public.app_bookings (status, booking_date);

create table if not exists public.app_schedule_blocks (
  id text primary key,
  block_date date not null,
  record jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_reserved_slots (
  id bigint generated always as identity primary key,
  slot_date date not null,
  court_id smallint not null check (court_id between 1 and 9),
  slot_time text not null check (slot_time ~ '^(0[8-9]|1[0-9]|2[01]):00$'),
  booking_id text references public.app_bookings (id) on delete cascade,
  block_id text references public.app_schedule_blocks (id) on delete cascade,
  status text not null check (status in ('pending', 'confirmed', 'cancelled', 'rejected', 'completed', 'blocked')),
  constraint app_reserved_slots_one_owner check ((booking_id is null) <> (block_id is null))
);

create unique index if not exists app_reserved_slots_active_unique
  on public.app_reserved_slots (slot_date, court_id, slot_time)
  where status in ('pending', 'confirmed', 'blocked');

create table if not exists public.app_otps (
  contact text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts smallint not null default 0 check (attempts between 0 and 5)
);

create table if not exists public.app_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts >= 0)
);

create table if not exists public.app_sessions (
  token text primary key,
  username text not null,
  role text not null,
  expires_at timestamptz not null
);

alter table public.app_bookings enable row level security;
alter table public.app_schedule_blocks enable row level security;
alter table public.app_reserved_slots enable row level security;
alter table public.app_otps enable row level security;
alter table public.app_rate_limits enable row level security;
alter table public.app_sessions enable row level security;

create or replace function public.create_app_booking(p_record jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  slot jsonb;
begin
  insert into public.app_bookings (id, booking_date, username, status, record, created_at)
  values (
    p_record->>'id',
    (p_record->>'date')::date,
    p_record->>'user',
    p_record->>'status',
    p_record,
    coalesce((p_record->>'createdAt')::timestamptz, now())
  );

  for slot in select value from jsonb_array_elements(coalesce(p_record->'slots', '[]'::jsonb))
  loop
    insert into public.app_reserved_slots (slot_date, court_id, slot_time, booking_id, status)
    values (
      (p_record->>'date')::date,
      (slot->>'courtId')::smallint,
      slot->>'time',
      p_record->>'id',
      p_record->>'status'
    );
  end loop;
end;
$$;

create or replace function public.update_app_booking(p_record jsonb, p_expected_status text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_count integer;
  current_status text;
begin
  select status into current_status
  from public.app_bookings
  where id = p_record->>'id'
  for update;

  if not found or current_status <> p_expected_status then
    return false;
  end if;

  if not (
    (current_status = 'pending' and p_record->>'status' in ('confirmed', 'rejected', 'cancelled')) or
    (current_status = 'confirmed' and p_record->>'status' in ('rejected', 'cancelled', 'completed'))
  ) then
    raise exception 'Invalid reservation status transition.'
      using errcode = '40001';
  end if;

  update public.app_bookings
  set booking_date = (p_record->>'date')::date,
      username = p_record->>'user',
      status = p_record->>'status',
      record = p_record
  where id = p_record->>'id';

  get diagnostics updated_count = row_count;
  if updated_count = 0 then
    return false;
  end if;

  update public.app_reserved_slots
  set status = p_record->>'status'
  where booking_id = p_record->>'id';

  return true;
end;
$$;

create or replace function public.create_app_schedule_block(p_record jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  slot jsonb;
begin
  insert into public.app_schedule_blocks (id, block_date, record, created_at)
  values (
    p_record->>'id',
    (p_record->>'date')::date,
    p_record,
    coalesce((p_record->>'createdAt')::timestamptz, now())
  );

  for slot in select value from jsonb_array_elements(coalesce(p_record->'slots', '[]'::jsonb))
  loop
    insert into public.app_reserved_slots (slot_date, court_id, slot_time, block_id, status)
    values (
      (p_record->>'date')::date,
      (slot->>'courtId')::smallint,
      slot->>'time',
      p_record->>'id',
      'blocked'
    );
  end loop;
end;
$$;

create or replace function public.delete_app_schedule_block(p_id text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from public.app_schedule_blocks where id = p_id;
  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

create or replace function public.consume_app_otp(p_contact text, p_code_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stored public.app_otps%rowtype;
begin
  select * into stored
  from public.app_otps
  where contact = p_contact
  for update;

  if not found then
    return false;
  end if;

  if stored.expires_at <= now() or stored.attempts >= 5 then
    delete from public.app_otps where contact = p_contact;
    return false;
  end if;

  if stored.code_hash <> p_code_hash then
    update public.app_otps
    set attempts = attempts + 1
    where contact = p_contact;
    if stored.attempts + 1 >= 5 then
      delete from public.app_otps where contact = p_contact;
    end if;
    return false;
  end if;

  delete from public.app_otps where contact = p_contact;
  return true;
end;
$$;

create or replace function public.allow_app_rate_limit(
  p_rate_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_attempts integer;
begin
  insert into public.app_rate_limits (rate_key, window_started_at, attempts)
  values (p_rate_key, now(), 1)
  on conflict (rate_key) do update
  set window_started_at = case
        when app_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
          then now()
        else app_rate_limits.window_started_at
      end,
      attempts = case
        when app_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
          then 1
        else app_rate_limits.attempts + 1
      end
  returning attempts into current_attempts;

  return current_attempts <= p_limit;
end;
$$;

revoke all on function public.create_app_booking(jsonb) from public, anon, authenticated;
revoke all on function public.update_app_booking(jsonb, text) from public, anon, authenticated;
revoke all on function public.create_app_schedule_block(jsonb) from public, anon, authenticated;
revoke all on function public.delete_app_schedule_block(text) from public, anon, authenticated;
revoke all on function public.consume_app_otp(text, text) from public, anon, authenticated;
revoke all on function public.allow_app_rate_limit(text, integer, integer) from public, anon, authenticated;

grant execute on function public.create_app_booking(jsonb) to service_role;
grant execute on function public.update_app_booking(jsonb, text) to service_role;
grant execute on function public.create_app_schedule_block(jsonb) to service_role;
grant execute on function public.delete_app_schedule_block(text) to service_role;
grant execute on function public.consume_app_otp(text, text) to service_role;
grant execute on function public.allow_app_rate_limit(text, integer, integer) to service_role;

grant all on public.app_bookings, public.app_schedule_blocks, public.app_reserved_slots,
  public.app_otps, public.app_rate_limits, public.app_sessions to service_role;
grant usage, select on sequence public.app_reserved_slots_id_seq to service_role;
