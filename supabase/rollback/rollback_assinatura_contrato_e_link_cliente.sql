-- Rollback: assinatura do contrato + link público + armazenamento/preview do PDF no Storage
--
-- O que este script remove (schema):
-- - Tabela `public.loan_signature_requests` (tokens/assinaturas)
-- - Colunas em `public.loans`: `is_authorized`, `authorized_at`, `contract_pdf_path`, `contract_pdf_uploaded_at`
-- - Bucket Storage `contratos` + policies relacionadas + objetos do bucket
--
-- IMPORTANTE:
-- - Isso NÃO reverte o código do frontend automaticamente.
-- - Rode no projeto Supabase correto (multi-empresa = repetir por instância, se aplicável).
-- - Faça backup antes (especialmente se já houver PDFs/assinaturas que você queira manter).

begin;

-- ---------------------------------------------------------------------------
-- Storage: policies do bucket "contratos"
-- ---------------------------------------------------------------------------
drop policy if exists "Public read contratos" on storage.objects;
drop policy if exists "Authenticated upload contratos" on storage.objects;
drop policy if exists "Authenticated update contratos" on storage.objects;
drop policy if exists "Anon upload contratos" on storage.objects;
drop policy if exists "Anon update contratos" on storage.objects;
drop policy if exists "Write contratos (insert) by role" on storage.objects;
drop policy if exists "Write contratos (update) by role" on storage.objects;

-- Remove arquivos do bucket antes de remover o bucket (evita lixo/orfãos)
-- Supabase bloqueia DELETE direto em `storage.*` sem o "modo" autorizado:
-- `storage.allow_delete_query = true` (ver `storage.protect_delete()`).
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'contratos';

-- Remove o bucket (se existir)
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.buckets where id = 'contratos';

-- ---------------------------------------------------------------------------
-- App tables / columns
-- ---------------------------------------------------------------------------
drop table if exists public.loan_signature_requests cascade;

alter table if exists public.loans
  drop column if exists is_authorized;

alter table if exists public.loans
  drop column if exists authorized_at;

alter table if exists public.loans
  drop column if exists contract_pdf_path;

alter table if exists public.loans
  drop column if exists contract_pdf_uploaded_at;

-- Índices criados pelas migrations (se ainda existirem)
drop index if exists public.loans_is_authorized_idx;
drop index if exists public.loans_contract_pdf_path_idx;
drop index if exists public.loan_signature_requests_contract_pdf_path_idx;

commit;
