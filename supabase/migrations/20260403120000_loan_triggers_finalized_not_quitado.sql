-- Finalizado não é quitado: evita paid_loans / overdue_loans incorretos ao mudar para finalized.
-- Compatível com esquemas que já têm insert_paid_loan, insert_overdue_loan, cleanup_loan_status_tables.

-- 1) Só inserir em paid_loans quando o status vira exatamente "paid" (nunca "finalized").
create or replace function public.insert_paid_loan()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'paid'
     and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    insert into public.paid_loans (
      loan_id,
      client_id,
      original_amount,
      interest_rate,
      total_with_interest,
      loan_date,
      due_date,
      total_paid,
      created_by
    )
    values (
      new.id,
      new.client_id,
      new.amount,
      new.interest_rate,
      new.amount + (new.amount * new.interest_rate / 100),
      new.loan_date,
      new.due_date,
      coalesce((select sum(amount) from public.payments where loan_id = new.id), 0),
      new.created_by
    )
    on conflict (loan_id) do nothing;
  end if;
  return new;
end;
$$;

-- 2) Não manter/atualizar overdue quando o contrato está finalizado (ou quitado/cancelado).
create or replace function public.insert_overdue_loan()
returns trigger
language plpgsql
as $$
begin
  if new.due_date < current_date
     and new.status not in ('paid', 'cancelled', 'finalized') then
    insert into public.overdue_loans (
      loan_id,
      client_id,
      original_amount,
      interest_rate,
      total_with_interest,
      loan_date,
      due_date,
      days_overdue,
      remaining_amount,
      total_paid,
      created_by
    )
    values (
      new.id,
      new.client_id,
      new.amount,
      new.interest_rate,
      new.amount + (new.amount * new.interest_rate / 100),
      new.loan_date,
      new.due_date,
      current_date - new.due_date,
      (new.amount + (new.amount * new.interest_rate / 100))
        - coalesce((select sum(amount) from public.payments where loan_id = new.id), 0),
      coalesce((select sum(amount) from public.payments where loan_id = new.id), 0),
      new.created_by
    )
    on conflict (loan_id) do update set
      days_overdue = current_date - new.due_date,
      remaining_amount = (new.amount + (new.amount * new.interest_rate / 100))
        - coalesce((select sum(amount) from public.payments where loan_id = new.id), 0),
      total_paid = coalesce((select sum(amount) from public.payments where loan_id = new.id), 0),
      updated_at = now();
  end if;
  return new;
end;
$$;

-- 3) Ao finalizar, limpar filas auxiliares como se fosse encerramento operacional (não quitação).
create or replace function public.cleanup_loan_status_tables()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('paid', 'cancelled', 'finalized') then
    delete from public.overdue_loans where loan_id = new.id;
  end if;

  if new.status in ('paid', 'cancelled', 'finalized') then
    delete from public.partial_paid_loans where loan_id = new.id;
  end if;

  if new.status = 'cancelled' then
    delete from public.paid_loans where loan_id = new.id;
  end if;

  return new;
end;
$$;

-- 4) Garantir que não permanece linha em paid_loans para contrato apenas finalizado.
create or replace function public.cleanup_paid_loans_on_finalize()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.status = 'finalized' and old.status is distinct from 'finalized' then
    delete from public.paid_loans where loan_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trigger_cleanup_paid_on_finalize on public.loans;

create trigger trigger_cleanup_paid_on_finalize
  after update on public.loans
  for each row
  execute function public.cleanup_paid_loans_on_finalize();

comment on function public.cleanup_paid_loans_on_finalize() is
  'Remove paid_loans ao passar para finalized; finalizar não é quitação.';
