-- Mantener activo el proyecto (plan gratis de Supabase: se pausa tras 7 días sin uso).
-- Se llama desde un cron (cPanel o Vercel) con la llave publicable; no expone datos.
create or replace function public.keepalive()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object('ok', true, 'empresas', (select count(*) from public.empresas), 'en', now());
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
