-- Policies de escrita no bucket "contratos" baseadas em auth.role().
-- Isso costuma resolver 403 quando o JWT não casa exatamente com roles `TO anon/authenticated`
-- (ou quando há diferenças entre ambientes).

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Write contratos (insert) by role') then
    null;
  else
    create policy "Write contratos (insert) by role"
    on storage.objects
    for insert
    with check (
      bucket_id = 'contratos'
      and auth.role() in ('anon', 'authenticated')
    );
  end if;

  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Write contratos (update) by role') then
    null;
  else
    create policy "Write contratos (update) by role"
    on storage.objects
    for update
    using (
      bucket_id = 'contratos'
      and auth.role() in ('anon', 'authenticated')
    )
    with check (
      bucket_id = 'contratos'
      and auth.role() in ('anon', 'authenticated')
    );
  end if;
end $$;
