-- CRED CARD - IMPERATRIZ: login por token via WhatsApp
-- Adiciona telefone do usuário e tabela de tokens (não apaga dados existentes).

-- 1) Telefone do usuário para receber o token no WhatsApp
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone TEXT;

COMMENT ON COLUMN public.users.phone IS 'Telefone WhatsApp (com DDI) para envio do token de login';

CREATE INDEX IF NOT EXISTS idx_users_phone ON public.users (phone);

-- 2) Tokens de login (hash + expiração)
CREATE TABLE IF NOT EXISTS public.login_tokens (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS login_tokens_email_idx ON public.login_tokens (email);
CREATE INDEX IF NOT EXISTS login_tokens_expires_idx ON public.login_tokens (expires_at);

ALTER TABLE public.login_tokens DISABLE ROW LEVEL SECURITY;

-- Exemplo: cadastrar telefone de um usuário existente
-- UPDATE public.users SET phone = '5598999999999' WHERE email = 'admin@credcard.com';
