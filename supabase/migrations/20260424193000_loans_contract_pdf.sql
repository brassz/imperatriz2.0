-- Armazenamento do PDF do contrato (gerado na criação do empréstimo).

alter table if exists public.loans
add column if not exists contract_pdf_path text;

alter table if exists public.loans
add column if not exists contract_pdf_uploaded_at timestamptz;

create index if not exists loans_contract_pdf_path_idx on public.loans (contract_pdf_path);

