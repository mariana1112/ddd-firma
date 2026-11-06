-- Trwałe usunięcie zdjęcia z kosza usuwa też jego plik z magazynu. Robi to tylko właściciel firmy.
create policy "Zdjęcia: usuwanie przez właściciela" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and private.has_role(private.path_org(name), array['owner']));
