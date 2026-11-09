-- Billaura: item photos (run once in Supabase → SQL Editor)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 524288, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 524288, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "photos public read" on storage.objects;
drop policy if exists "photos shop insert" on storage.objects;
drop policy if exists "photos shop update" on storage.objects;
drop policy if exists "photos shop delete" on storage.objects;

-- anyone can view (the store page is public)
create policy "photos public read" on storage.objects for select using (bucket_id = 'product-photos');
-- a shop can only write inside its own folder:  <shop_id>/<file>.jpg
create policy "photos shop insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and (storage.foldername(name))[1] = public.my_shop_id()::text);
create policy "photos shop update" on storage.objects for update to authenticated
  using (bucket_id = 'product-photos' and (storage.foldername(name))[1] = public.my_shop_id()::text);
create policy "photos shop delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and (storage.foldername(name))[1] = public.my_shop_id()::text);
