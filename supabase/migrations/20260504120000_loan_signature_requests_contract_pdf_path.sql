-- Permite preview do contrato no link público sem depender de SELECT em loans (RLS).

alter table if exists public.loan_signature_requests
add column if not exists contract_pdf_path text;

create index if not exists loan_signature_requests_contract_pdf_path_idx
on public.loan_signature_requests (contract_pdf_path);

