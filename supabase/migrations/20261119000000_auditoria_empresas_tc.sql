-- =====================================================================
-- Correcciones de la auditoría (19/11/2026). Se puede correr más de una vez.
-- Requiere 20261118000000_tc_fijo_empresas_usuario_nuevos.sql
-- =====================================================================

-- A1 / B2. Empresa asignada (y activa) para crear y también para modificar --------
create or replace function public.puede_cotizar_empresa(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_admin()
      or exists (select 1 from public.perfil_empresas pe join public.empresas e on e.id = pe.empresa_id
                  where pe.perfil_id = auth.uid() and pe.empresa_id = p_empresa and e.activo);
$$;

-- Modificar una cotización ya creada (editar, emitir, anular, ítems): su empresa asignada,
-- o el permiso "Ver y editar las cotizaciones de todos" (Coordinador y quien apruebe por todos).
-- Crear (nueva, duplicar, nueva versión) sigue exigiendo la empresa asignada.
create or replace function public.puede_modificar_empresa(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.puede_cotizar_empresa(p_empresa) or public.tiene_permiso('cotizaciones_todas');
$$;

create or replace function public.cot_tc_y_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tc numeric;
begin
  select tipo_cambio into v_tc from public.empresas where id = new.empresa_id;
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.puede_cotizar_empresa(new.empresa_id) then
      raise exception 'No tienes permiso para cotizar con esta empresa';
    end if;
    new.tipo_cambio := v_tc;
  else
    -- El recálculo de totales lo hace la base: no se bloquea
    if auth.uid() is not null and coalesce(current_setting('hanlo.recalculando', true), '0') <> '1'
       and not public.puede_modificar_empresa(old.empresa_id) then
      raise exception 'No tienes permiso para cotizar con esta empresa';
    end if;
    if new.tipo_cambio is distinct from old.tipo_cambio then
      new.tipo_cambio := v_tc;
    end if;
  end if;
  return new;
end $$;

-- Ítems: se ven si se ve la cotización; se escriben solo con la empresa asignada
drop policy if exists "items de cotizaciones visibles" on public.cotizacion_items;
drop policy if exists "ver items de cotizaciones visibles" on public.cotizacion_items;
drop policy if exists "escribir items con empresa asignada" on public.cotizacion_items;
create policy "ver items de cotizaciones visibles" on public.cotizacion_items for select to authenticated
  using (exists (select 1 from public.cotizaciones c where c.id = cotizacion_id));
create policy "escribir items con empresa asignada" on public.cotizacion_items for all to authenticated
  using (exists (select 1 from public.cotizaciones c where c.id = cotizacion_id and public.puede_modificar_empresa(c.empresa_id)))
  with check (exists (select 1 from public.cotizaciones c where c.id = cotizacion_id and public.puede_modificar_empresa(c.empresa_id)));

-- M1. T.C. de la empresa en un rango realista y el límite con el mayor T.C. --------
alter table public.empresas drop constraint if exists empresas_tipo_cambio_check;
alter table public.empresas add constraint empresas_tipo_cambio_check check (tipo_cambio between 2.5 and 5);

create or replace function public.total_para_limite(c public.cotizaciones)
returns numeric language sql stable set search_path = public as $$
  select case when c.moneda = 'USD'
    then c.total * greatest(coalesce(c.tipo_cambio, 0),
                            coalesce((select e.tipo_cambio from public.empresas e where e.id = c.empresa_id), 0), 1)
    else c.total end;
$$;

-- B4. Empresas de un usuario en un solo paso (si algo falla, no queda sin empresas) --
create or replace function public.asignar_empresas(p_perfil uuid, p_empresas uuid[])
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo el Administrador asigna empresas'; end if;
  delete from public.perfil_empresas where perfil_id = p_perfil;
  insert into public.perfil_empresas (perfil_id, empresa_id)
  select p_perfil, x from unnest(coalesce(p_empresas, '{}')) as x
  on conflict do nothing;
end $$;

-- B7. Las funciones no se ejecutan sin sesión (anon): solo usuarios autenticados ------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', f.firma);
    execute format('grant execute on function %s to authenticated, service_role', f.firma);
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

notify pgrst, 'reload schema';
