-- Clientes-alvo opcionais: vazio = todos os elegíveis; senão só esses IDs.
alter table public.whatsapp_schedules
  add column if not exists target_client_ids jsonb not null default '[]'::jsonb;
