-- Assinatura/consentimento do contrato via link público.

create extension if not exists pgcrypto;

alter table if exists public.loans
add column if not exists is_authorized boolean not null default false;

alter table if exists public.loans
add column if not exists authorized_at timestamptz;

create index if not exists loans_is_authorized_idx on public.loans (is_authorized);

create table if not exists public.loan_signature_requests (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  accepted_terms boolean not null default false,
  signer_name text,
  signature_data_url text
);

create index if not exists loan_signature_requests_loan_id_idx on public.loan_signature_requests (loan_id);
create index if not exists loan_signature_requests_token_hash_idx on public.loan_signature_requests (token_hash);
create index if not exists loan_signature_requests_expires_idx on public.loan_signature_requests (expires_at);

