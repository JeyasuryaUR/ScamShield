-- Scam Shield schema
-- Writes go through SECURITY DEFINER functions so every state change is also
-- written to the append-only, hash-chained audit_log in the same transaction.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('analyst', 'compliance', 'admin');
create type public.txn_action as enum ('allow', 'verify', 'hold');
create type public.decision_status as enum (
  'allowed',             -- low risk, went through
  'awaiting_customer',   -- verify: step-up check shown to the customer
  'pending_review',      -- hold: waiting for an analyst
  'released',            -- analyst released a hold
  'blocked',             -- analyst kept the hold
  'customer_verified',   -- customer passed the step-up check
  'customer_cancelled'   -- customer cancelled after the warning
);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null,
  role public.app_role not null default 'analyst',
  created_at timestamptz not null default now()
);

create table public.transactions (
  id text primary key,
  account_id text not null,
  payee_id text not null,
  amount numeric(14, 2) not null check (amount > 0),
  type text not null,
  ts timestamptz not null,
  old_balance numeric(14, 2) not null,
  channel text not null default 'stream',
  received_at timestamptz not null default now()
);
create index transactions_account_idx on public.transactions (account_id, ts desc);

create table public.decisions (
  id bigint generated always as identity primary key,
  txn_id text not null unique references public.transactions (id),
  risk real not null check (risk between 0 and 1),
  action public.txn_action not null,
  status public.decision_status not null,
  reasons jsonb not null default '[]',
  features jsonb not null default '{}',
  model_version text not null,
  latency_ms real not null,
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index decisions_queue_idx on public.decisions (decided_at desc) where action <> 'allow';
create index decisions_status_idx on public.decisions (status);

create table public.reviews (
  id bigint generated always as identity primary key,
  decision_id bigint not null references public.decisions (id),
  reviewer_id uuid not null references public.profiles (id),
  verdict text not null check (verdict in ('release', 'keep_hold')),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index reviews_decision_idx on public.reviews (decision_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  actor text not null,       -- 'scorer' | 'customer' | auth user id
  event text not null,       -- decision.created | review.release | review.keep_hold | customer.*
  txn_id text,
  decision_id bigint,
  payload jsonb not null,
  prev_hash text,
  hash text not null
);
create index audit_log_txn_idx on public.audit_log (txn_id);
create index audit_log_at_idx on public.audit_log (at desc);

create table public.model_versions (
  version text primary key,
  metrics jsonb not null,
  policy jsonb not null,
  created_at timestamptz not null default now()
);

create table public.shortcut_audits (
  id bigint generated always as identity primary key,
  model_version text references public.model_versions (version),
  mode text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit log: append-only + hash chain (each row hashes the previous row's hash)
-- ---------------------------------------------------------------------------
create function private.audit_hash(prev text, event text, txn text, payload jsonb, at timestamptz)
returns text language sql immutable set search_path = '' as $$
  select encode(
    extensions.digest(
      coalesce(prev, '') || '|' || event || '|' || coalesce(txn, '') || '|' || payload::text || '|' || extract(epoch from at)::text,
      'sha256'),
    'hex')
$$;

create function private.append_audit(p_actor text, p_event text, p_txn text, p_decision bigint, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_prev text;
  v_at timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtext('scamshield.audit_log'));
  select hash into v_prev from public.audit_log order by id desc limit 1;
  insert into public.audit_log (at, actor, event, txn_id, decision_id, payload, prev_hash, hash)
  values (v_at, p_actor, p_event, p_txn, p_decision, p_payload, v_prev,
          private.audit_hash(v_prev, p_event, p_txn, p_payload, v_at));
end $$;

create function private.reject_change() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function private.reject_change();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.reject_change();

-- Anyone on staff can check the chain is intact.
create function public.verify_audit_chain()
returns table (ok boolean, checked bigint, first_bad_id bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
  v_prev text := null;
  n bigint := 0;
begin
  for r in select * from public.audit_log order by id loop
    n := n + 1;
    if r.prev_hash is distinct from v_prev
       or r.hash <> private.audit_hash(v_prev, r.event, r.txn_id, r.payload, r.at) then
      return query select false, n, r.id;
      return;
    end if;
    v_prev := r.hash;
  end loop;
  return query select true, n, null::bigint;
end $$;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create function private.has_role(roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = any (roles))
$$;

create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(array['analyst', 'compliance', 'admin']::public.app_role[])
$$;

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Write paths
-- ---------------------------------------------------------------------------

-- Called by the scorer's background sink with a batch of {txn, decision, features}.
create function public.ingest_decisions(payload jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  t jsonb;
  d jsonb;
  v_id bigint;
  n integer := 0;
begin
  for item in select * from jsonb_array_elements(payload) loop
    t := item -> 'txn';
    d := item -> 'decision';

    insert into public.transactions (id, account_id, payee_id, amount, type, ts, old_balance, channel)
    values (t ->> 'txn_id', t ->> 'account_id', t ->> 'payee_id', (t ->> 'amount')::numeric, t ->> 'type',
            (t ->> 'ts')::timestamptz, (t ->> 'old_balance')::numeric, coalesce(t ->> 'channel', 'stream'))
    on conflict (id) do nothing;

    insert into public.decisions (txn_id, risk, action, status, reasons, features, model_version, latency_ms)
    values (
      t ->> 'txn_id',
      (d ->> 'risk')::real,
      (d ->> 'action')::public.txn_action,
      case d ->> 'action'
        when 'allow' then 'allowed'
        when 'verify' then 'awaiting_customer'
        else 'pending_review'
      end::public.decision_status,
      coalesce(d -> 'reasons', '[]'),
      coalesce(item -> 'features', '{}'),
      d ->> 'model_version',
      (d ->> 'latency_ms')::real
    )
    on conflict (txn_id) do nothing
    returning id into v_id;

    if v_id is not null then
      perform private.append_audit('scorer', 'decision.created', t ->> 'txn_id', v_id, item);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Analyst releases or keeps a held payment.
create function public.review_decision(p_decision_id bigint, p_verdict text, p_note text default null)
returns public.decision_status
language plpgsql security definer set search_path = '' as $$
declare
  v_d public.decisions;
  v_status public.decision_status;
begin
  if not private.has_role(array['analyst', 'admin']::public.app_role[]) then
    raise exception 'only analysts can review payments' using errcode = '42501';
  end if;
  if p_verdict not in ('release', 'keep_hold') then
    raise exception 'verdict must be release or keep_hold' using errcode = '22023';
  end if;

  select * into v_d from public.decisions where id = p_decision_id for update;
  if not found then
    raise exception 'decision % not found', p_decision_id using errcode = 'P0002';
  end if;
  if v_d.status <> 'pending_review' then
    raise exception 'decision is %, not pending review', v_d.status using errcode = '55000';
  end if;

  v_status := case p_verdict when 'release' then 'released' else 'blocked' end;
  insert into public.reviews (decision_id, reviewer_id, verdict, note)
  values (p_decision_id, auth.uid(), p_verdict, nullif(trim(p_note), ''));
  update public.decisions set status = v_status, updated_at = now() where id = p_decision_id;

  perform private.append_audit(auth.uid()::text, 'review.' || p_verdict, v_d.txn_id, p_decision_id,
    jsonb_build_object('verdict', p_verdict, 'note', p_note, 'previous_status', v_d.status,
                       'risk', v_d.risk, 'reasons', v_d.reasons, 'model_version', v_d.model_version));
  return v_status;
end $$;

-- Customer answers the warning (called server-side by the /pay demo with the service key).
create function public.customer_respond(p_txn_id text, p_outcome text)
returns public.decision_status
language plpgsql security definer set search_path = '' as $$
declare
  v_d public.decisions;
  v_status public.decision_status;
begin
  if p_outcome not in ('verified', 'cancelled') then
    raise exception 'outcome must be verified or cancelled' using errcode = '22023';
  end if;
  select * into v_d from public.decisions where txn_id = p_txn_id for update;
  if not found then
    raise exception 'decision for % not found', p_txn_id using errcode = 'P0002';
  end if;
  if v_d.status = 'awaiting_customer' then
    v_status := case p_outcome when 'verified' then 'customer_verified' else 'customer_cancelled' end;
  elsif v_d.status = 'pending_review' and p_outcome = 'cancelled' then
    v_status := 'customer_cancelled';
  else
    raise exception 'decision is %, customer cannot %', v_d.status, p_outcome using errcode = '55000';
  end if;

  update public.decisions set status = v_status, updated_at = now() where id = v_d.id;
  perform private.append_audit('customer', 'customer.' || p_outcome, p_txn_id, v_d.id,
    jsonb_build_object('previous_status', v_d.status, 'risk', v_d.risk, 'reasons', v_d.reasons));
  return v_status;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges + row level security
-- ---------------------------------------------------------------------------
revoke all on all functions in schema private from public;
grant usage on schema private to authenticated;
grant execute on function private.has_role(public.app_role[]), private.is_staff() to authenticated;

revoke execute on function public.ingest_decisions(jsonb), public.customer_respond(text, text)
  from public, anon, authenticated;
grant execute on function public.ingest_decisions(jsonb), public.customer_respond(text, text) to service_role;
revoke execute on function public.review_decision(bigint, text, text), public.verify_audit_chain()
  from public, anon;
grant execute on function public.review_decision(bigint, text, text), public.verify_audit_chain()
  to authenticated;

revoke all on all tables in schema public from anon;

alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.decisions enable row level security;
alter table public.reviews enable row level security;
alter table public.audit_log enable row level security;
alter table public.model_versions enable row level security;
alter table public.shortcut_audits enable row level security;

-- Reads only. Every write goes through the functions above (or the service role).
create policy "own profile or staff" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));
create policy "staff read" on public.transactions for select to authenticated using ((select private.is_staff()));
create policy "staff read" on public.decisions for select to authenticated using ((select private.is_staff()));
create policy "staff read" on public.reviews for select to authenticated using ((select private.is_staff()));
create policy "staff read" on public.audit_log for select to authenticated using ((select private.is_staff()));
create policy "staff read" on public.model_versions for select to authenticated using ((select private.is_staff()));
create policy "staff read" on public.shortcut_audits for select to authenticated using ((select private.is_staff()));

-- Live review queue
alter publication supabase_realtime add table public.decisions;
