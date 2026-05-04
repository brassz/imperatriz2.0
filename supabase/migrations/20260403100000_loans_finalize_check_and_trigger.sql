-- Finalizar empréstimo: o trigger legado calculate_loan_status() sobrescrevia qualquer UPDATE
-- de status (ex.: finalized) com active/overdue/due_today. O CHECK antigo também barrava
-- finalized e installments. Aplique com: supabase db push / SQL no painel.

-- 1) CHECK em status alinhado ao app (inclui due_today usado por triggers antigos)
alter table public.loans drop constraint if exists loans_status_check;

alter table public.loans add constraint loans_status_check check (
  status = any (
    array[
      'active'::text,
      'overdue'::text,
      'paid'::text,
      'partial_paid'::text,
      'cancelled'::text,
      'installments'::text,
      'finalized'::text,
      'due_today'::text
    ]
  )
);

-- 2) Não recalcular por data quando o status é manual / terminal
create or replace function public.calculate_loan_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is not null
     and new.status in (
       'paid',
       'cancelled',
       'finalized',
       'installments',
       'partial_paid'
     ) then
    return new;
  end if;

  if new.due_date < current_date then
    new.status = 'overdue';
  elsif new.due_date = current_date then
    new.status = 'due_today';
  else
    new.status = 'active';
  end if;

  return new;
end;
$$;

comment on function public.calculate_loan_status() is
  'Atualiza active/overdue/due_today por data; preserva paid, cancelled, finalized, installments, partial_paid.';
