-- Device sign-in public keys for KoolMovez.
-- Apply manually in the Supabase SQL editor for project qslfgnrivaacfwsojjhh.
-- Do not run this from the app, and do not change Auth provider settings,
-- email templates, or password recovery while applying it.
--
-- These tables store a COSE public key and a signature counter. They do not
-- store a fingerprint, face image, device PIN, password, or private key.
-- Row level security is forced on and there are no policies, so the anon and
-- authenticated keys cannot read or write the rows. The passkey API uses the
-- service role only after WebAuthn verification.

create table if not exists public.passkey_credentials (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0 check (counter >= 0),
  transports text[] not null default '{}',
  device_label text not null check (char_length(device_label) between 1 and 80),
  user_handle text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.passkey_challenges (
  challenge text primary key,
  kind text not null check (kind in ('registration', 'authentication')),
  user_id uuid references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  ip_hash text not null,
  device_label text not null,
  created_at timestamptz not null default now()
);

create index if not exists passkey_credentials_user_idx
  on public.passkey_credentials (user_id, created_at);

create index if not exists passkey_challenges_rate_idx
  on public.passkey_challenges (kind, created_at);

alter table public.passkey_credentials enable row level security;
alter table public.passkey_credentials force row level security;
alter table public.passkey_challenges enable row level security;
alter table public.passkey_challenges force row level security;

revoke all on table public.passkey_credentials from public, anon, authenticated;
revoke all on table public.passkey_challenges from public, anon, authenticated;
