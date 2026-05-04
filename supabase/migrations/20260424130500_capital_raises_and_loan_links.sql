-- Captação de capital: Levantamentos + vínculo opcional em empréstimos.
-- Percentual de juros é total do período (ex.: 10 = 10% no prazo).

-- UUID helper (em muitos projetos Supabase já vem habilitado; mantemos seguro).
create extension if not exists pgcrypto;

create table if not exists public.capital_raises (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  investidor text,
  valor_levantado numeric not null,
  juros_percent_total numeric not null,
  prazo_meses int not null,
  data_inicio date not null default current_date,
  data_vencimento date,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists capital_raises_ativo_idx on public.capital_raises (ativo);
create index if not exists capital_raises_data_inicio_idx on public.capital_raises (data_inicio);

-- Vínculo opcional: 1 Levantamento → N Empréstimos.
alter table if exists public.loans
add column if not exists capital_raise_id uuid references public.capital_raises (id) on delete set null;

alter table if exists public.loans
add column if not exists capital_raise_capital numeric;

alter table if exists public.loans
add column if not exists capital_raise_interest numeric;

create index if not exists loans_capital_raise_id_idx on public.loans (capital_raise_id);

