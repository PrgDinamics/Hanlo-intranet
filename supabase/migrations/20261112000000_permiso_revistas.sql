-- =====================================================================
-- Permiso "revistas" (12/11/2026): publicar, ocultar y eliminar revistas virtuales
-- en hanloinnova.com/revistas. Se asigna en Configuración > Roles y permisos.
-- El rol Administrador (fijo) lo tiene siempre. Se puede correr más de una vez.
-- =====================================================================

create or replace function public.permisos_validos()
returns text[] language sql immutable as $$
  select array['cotizaciones_todas', 'aprobar', 'clientes', 'articulos', 'importar',
               'tipos_cambio', 'formas_pago', 'empresas', 'reportes', 'actividad', 'revistas']::text[];
$$;

-- La restricción usa la función: se vuelve a crear para que acepte el permiso nuevo
alter table public.roles drop constraint if exists roles_permisos_check;
alter table public.roles add constraint roles_permisos_check check (permisos <@ public.permisos_validos());

-- El Administrador queda con todos los permisos, incluido el nuevo
update public.roles set permisos = public.permisos_validos() where sistema;

notify pgrst, 'reload schema';
