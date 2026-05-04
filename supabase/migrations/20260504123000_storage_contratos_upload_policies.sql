-- Permite upload/alteração de PDFs no bucket "contratos" para usuários autenticados.

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Authenticated upload contratos') then
    null;
  else
    create policy "Authenticated upload contratos"
    on storage.objects
    for insert
    to authenticated
    with check (bucket_id = 'contratos');
  end if;

  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Authenticated update contratos') then
    null;
  else
    create policy "Authenticated update contratos"
    on storage.objects
    for update
    to authenticated
    using (bucket_id = 'contratos')
    with check (bucket_id = 'contratos');
  end if;
end $$;

