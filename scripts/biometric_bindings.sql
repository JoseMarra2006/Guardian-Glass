-- Biometric binding metadata (no biometric raw/template data)
create table if not exists public.user_biometric_bindings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  user_email text not null,
  device_id text not null,
  biometric_enabled boolean not null default false,
  preferred_method text not null default 'any'
    check (preferred_method in ('face', 'fingerprint', 'any')),
  last_biometric_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id)
);

alter table public.user_biometric_bindings enable row level security;

create policy "user_reads_own_biometric_binding"
  on public.user_biometric_bindings
  for select
  using (auth.uid() = user_id);

create policy "user_inserts_own_biometric_binding"
  on public.user_biometric_bindings
  for insert
  with check (auth.uid() = user_id);

create policy "user_updates_own_biometric_binding"
  on public.user_biometric_bindings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
