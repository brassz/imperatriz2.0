-- status = installments: contrato vinculado a um parcelamento ativo (não entra nas listagens de empréstimo; só no fluxo de parcelas).
comment on column public.loans.status is 'active | partial_paid | overdue | paid | cancelled | installments';
