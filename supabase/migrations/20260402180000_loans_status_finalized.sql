-- Empréstimo finalizado: some da operação diária; pagamentos permanecem em `payments`.
comment on column public.loans.status is 'active | partial_paid | overdue | paid | cancelled | installments | finalized';
