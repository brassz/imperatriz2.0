-- Captação de capital: parcelas do valor levantado (principal).
-- `parcelas` define em quantas partes o principal é dividido para acompanhamento.

alter table if exists public.capital_raises
add column if not exists parcelas int not null default 1;

create index if not exists capital_raises_parcelas_idx on public.capital_raises (parcelas);

