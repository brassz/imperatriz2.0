-- Necessário para suportar `ON CONFLICT (loan_id)` nos triggers (paid_loans/overdue_loans/partial_paid_loans).
-- Sem UNIQUE/EXCLUSION em `(loan_id)`, o Postgres retorna:
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification"

-- 1) paid_loans: 1 linha por loan_id
create unique index if not exists paid_loans_loan_id_unique_idx
on public.paid_loans (loan_id);

-- 2) overdue_loans: 1 linha por loan_id (fila de vencidos)
create unique index if not exists overdue_loans_loan_id_unique_idx
on public.overdue_loans (loan_id);

-- 3) partial_paid_loans: 1 linha por loan_id (quando existir no schema)
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'partial_paid_loans'
  ) then
    execute 'create unique index if not exists partial_paid_loans_loan_id_unique_idx on public.partial_paid_loans (loan_id)';
  end if;
end
$$;

