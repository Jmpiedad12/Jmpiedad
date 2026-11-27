alter table public.app_reserved_slots
  drop constraint if exists app_reserved_slots_slot_time_check;

alter table public.app_reserved_slots
  add constraint app_reserved_slots_slot_time_check
  check (slot_time ~ '^(0[8-9]|1[0-9]|2[0-3]):(00|30)$');

insert into public.app_reserved_slots (
  slot_date,
  court_id,
  slot_time,
  booking_id,
  block_id,
  status
)
select
  slot_date,
  court_id,
  to_char(date '2000-01-01' + slot_time::time + interval '30 minutes', 'HH24:MI'),
  booking_id,
  block_id,
  status
from public.app_reserved_slots
where slot_time like '%:00'
  and status in ('pending', 'confirmed', 'blocked');

create or replace function public.create_app_booking(p_record jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  slot jsonb;
  duration_minutes integer;
  half_hour_index integer;
  slot_start_minutes integer;
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
    duration_minutes := coalesce((slot->>'durationMinutes')::integer, 60);
    slot_start_minutes :=
      extract(hour from (slot->>'time')::time)::integer * 60
      + extract(minute from (slot->>'time')::time)::integer;
    if duration_minutes < 60
      or duration_minutes > 16 * 60
      or duration_minutes % 30 <> 0
      or slot_start_minutes < 8 * 60
      or slot_start_minutes > 23 * 60
      or slot_start_minutes % 30 <> 0
      or slot_start_minutes + duration_minutes > 24 * 60 then
      raise exception 'Invalid booking duration';
    end if;

    for half_hour_index in 0..(duration_minutes / 30 - 1)
    loop
      insert into public.app_reserved_slots (slot_date, court_id, slot_time, booking_id, status)
      values (
        (p_record->>'date')::date,
        (slot->>'courtId')::smallint,
        to_char(
          date '2000-01-01' + (slot->>'time')::time + interval '30 minutes' * half_hour_index,
          'HH24:MI'
        ),
        p_record->>'id',
        p_record->>'status'
      );
    end loop;
  end loop;
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

    insert into public.app_reserved_slots (slot_date, court_id, slot_time, block_id, status)
    values (
      (p_record->>'date')::date,
      (slot->>'courtId')::smallint,
      to_char(date '2000-01-01' + (slot->>'time')::time + interval '30 minutes', 'HH24:MI'),
      p_record->>'id',
      'blocked'
    );
  end loop;
end;
$$;
