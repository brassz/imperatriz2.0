-- Anulação de multa diária de atraso (R$ 50/dia civil) por empréstimo e dia.
create table if not exists public.loan_fine_waivers (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  waive_date date not null,
  created_at timestamptz not null default now(),
  unique (loan_id, waive_date)
);

create index if not exists loan_fine_waivers_loan_id_idx on public.loan_fine_waivers (loan_id);
