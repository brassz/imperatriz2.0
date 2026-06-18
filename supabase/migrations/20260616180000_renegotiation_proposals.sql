-- Propostas de renegociação (aba Renegociações / Capital Advocacia)
create table if not exists public.renegotiation_proposals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  debt_ref text not null,
  source_type text not null check (source_type in ('loan', 'installment')),
  client_name text not null,
  client_phone text,
  proposal_mode text not null,
  base_capital numeric(12, 2) not null,
  discount_percent numeric(5, 2) not null default 0,
  total_amount numeric(12, 2) not null,
  down_payment numeric(12, 2) not null default 0,
  down_payment_due_date date,
  installment_count int not null default 0,
  installment_amount numeric(12, 2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'finalized', 'converted')),
  new_loan_id uuid references public.loans (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  finalized_at timestamptz
);

create index if not exists renegotiation_proposals_client_id_idx on public.renegotiation_proposals (client_id);
create index if not exists renegotiation_proposals_status_idx on public.renegotiation_proposals (status);
create index if not exists renegotiation_proposals_debt_ref_idx on public.renegotiation_proposals (debt_ref);

alter table public.renegotiation_proposals disable row level security;
