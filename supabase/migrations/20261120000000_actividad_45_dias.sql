-- =====================================================================
-- Registro de actividad: se guarda 45 días (20/11/2026). Se puede correr más de una vez.
-- La tarea diaria /api/keepalive llama a keepalive() y borra lo más antiguo.
-- El historial de cada cotización (creada, emitida, aprobada, anulada) NO se borra.
-- Para conservar algo más tiempo: Registro de actividad > Exportar Excel.
-- =====================================================================
create or replace function public.keepalive()
returns json language plpgsql security definer set search_path = public as $$
begin
  delete from public.actividad where created_at < now() - interval '45 days';
  return json_build_object('ok', true, 'empresas', (select count(*) from public.empresas), 'en', now());
end $$;
-- Solo la llave secreta del servidor (no un usuario de la intranet)
revoke execute on function public.keepalive() from public, anon, authenticated;
grant execute on function public.keepalive() to service_role;

notify pgrst, 'reload schema';
