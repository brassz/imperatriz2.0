-- Login por token via WhatsApp (Evolution) - Nexus

-- 1) Adiciona telefone no usuário para receber token
alter table if exists public.users
add column if not exists phone text;

-- 2) Tabela de tokens de login (hash + expiração)
create table if not exists public.login_tokens (
  id bigserial primary key,
  email text not null,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists login_tokens_email_idx on public.login_tokens (email);
create index if not exists login_tokens_expires_idx on public.login_tokens (expires_at);

-- Nota: não criamos índice UNIQUE parcial aqui porque "IF NOT EXISTS"
-- não é suportado para índices parciais em todas as versões.

