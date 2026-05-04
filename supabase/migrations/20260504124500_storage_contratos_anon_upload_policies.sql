-- Policies adicionais para upload/upsert no bucket "contratos" via role `anon`
-- (alguns ambientes usam JWT `anon` no client mesmo com login interno).

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Anon upload contratos') then
    null;
  else
    create policy "Anon upload contratos"
    on storage.objects
    for insert
    to anon
    with check (bucket_id = 'contratos');
  end if;

  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Anon update contratos') then
    null;
  else
    create policy "Anon update contratos"
    on storage.objects
    for update
    to anon
    using (bucket_id = 'contratos')
    with check (bucket_id = 'contratos');
  end if;
end $$;
