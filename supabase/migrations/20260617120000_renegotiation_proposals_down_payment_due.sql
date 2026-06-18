-- Data limite para pagamento da entrada (modalidade parcelado com entrada)
alter table public.renegotiation_proposals
  add column if not exists down_payment_due_date date;
