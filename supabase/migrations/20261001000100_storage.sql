-- Bucket público para fotos de artículos y logos de empresas
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

create policy "media lectura publica" on storage.objects
  for select using (bucket_id = 'media');

create policy "media subir autenticados" on storage.objects
  for insert to authenticated with check (bucket_id = 'media');

create policy "media actualizar autenticados" on storage.objects
  for update to authenticated using (bucket_id = 'media');

create policy "media borrar autenticados" on storage.objects
  for delete to authenticated using (bucket_id = 'media');
