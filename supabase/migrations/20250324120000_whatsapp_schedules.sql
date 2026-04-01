-- Agendamentos de envio WhatsApp executados no servidor (ex.: VPS + PM2/cron + whatsapp-scheduler.mjs).
-- Rode este SQL no SQL Editor de cada projeto Supabase que usar a automação.

create table if not exists public.whatsapp_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  company_id text not null,
  nome text not null default '',
  instance text not null,
  empresa text not null default '',
  horario text not null,
  dias jsonb not null default '[]'::jsonb,
  filtros jsonb not null default '[]'::jsonb,
  delay_minutos int not null default 7,
  ativo boolean not null default true,
  evolution_base_url text not null,
  evolution_api_key text not null,
  pix_tipo text not null,
  pix_titular text not null,
  pix_chave text not null,
  last_fired_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_schedules_user on public.whatsapp_schedules (user_id);
create index if not exists idx_whatsapp_schedules_ativo on public.whatsapp_schedules (ativo) where ativo = true;

alter table public.whatsapp_schedules enable row level security;

-- Mesmo padrão do restante do app (acesso via anon key no front).
drop policy if exists "whatsapp_schedules_all" on public.whatsapp_schedules;
create policy "whatsapp_schedules_all"
  on public.whatsapp_schedules for all
  using (true)
  with check (true);
