-- Bucket para armazenar PDFs de contratos e permitir preview no link público.

insert into storage.buckets (id, name, public)
values ('contratos', 'contratos', true)
on conflict (id) do nothing;

-- Permitir leitura pública dos PDFs do bucket "contratos"
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Public read contratos') then
    -- policy já existe
    null;
  else
    create policy "Public read contratos"
    on storage.objects
    for select
    using (bucket_id = 'contratos');
  end if;
end $$;

