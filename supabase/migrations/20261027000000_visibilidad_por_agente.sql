-- =====================================================================
-- Cada vendedor ve SOLO sus cotizaciones; el administrador ve todas.
-- "Suyas" = las que creó él, o las asignadas a su agente comercial.
-- Aplica a cotizaciones, ítems, historial, listados, dashboard y reportes
-- (todo lo que lee cotizaciones pasa por estas políticas).
-- =====================================================================

create or replace function public.ve_cotizacion(p_usuario uuid, p_agente uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfiles p
     where p.id = auth.uid() and p.activo
       and (p.rol = 'admin'
            or p_usuario = auth.uid()
            or (p.agente_id is not null and p.agente_id = p_agente))
  );
$$;
grant execute on function public.ve_cotizacion(uuid, uuid) to authenticated;

-- Un vendedor solo puede asignar la cotización a su propio agente (o a ninguno)
create or replace function public.agente_permitido(p_agente uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfiles p
     where p.id = auth.uid() and p.activo
       and (p.rol = 'admin' or p_agente is null or p.agente_id = p_agente)
  );
$$;
grant execute on function public.agente_permitido(uuid) to authenticated;

-- Cotizaciones
drop policy if exists "lectura autenticados" on public.cotizaciones;
drop policy if exists "insertar cotizaciones" on public.cotizaciones;
drop policy if exists "actualizar cotizaciones" on public.cotizaciones;
create policy "ver cotizaciones propias" on public.cotizaciones for select to authenticated
  using (public.ve_cotizacion(usuario_id, agente_id));
create policy "crear cotizaciones propias" on public.cotizaciones for insert to authenticated
  with check (public.agente_permitido(agente_id) and (usuario_id = auth.uid() or public.es_admin()));
create policy "actualizar cotizaciones propias" on public.cotizaciones for update to authenticated
  using (public.ve_cotizacion(usuario_id, agente_id))
  with check (public.ve_cotizacion(usuario_id, agente_id) and public.agente_permitido(agente_id));

-- Ítems: siguen la visibilidad de su cotización
drop policy if exists "lectura autenticados" on public.cotizacion_items;
drop policy if exists "escritura autenticados" on public.cotizacion_items;
create policy "items de cotizaciones visibles" on public.cotizacion_items for all to authenticated
  using (exists (select 1 from public.cotizaciones c where c.id = cotizacion_id))
  with check (exists (select 1 from public.cotizaciones c where c.id = cotizacion_id));

-- Historial: igual
drop policy if exists "lectura autenticados" on public.cotizacion_historial;
drop policy if exists "insertar historial" on public.cotizacion_historial;
create policy "ver historial de cotizaciones visibles" on public.cotizacion_historial for select to authenticated
  using (exists (select 1 from public.cotizaciones c where c.id = cotizacion_id));
create policy "insertar historial de cotizaciones visibles" on public.cotizacion_historial for insert to authenticated
  with check (exists (select 1 from public.cotizaciones c where c.id = cotizacion_id));

-- El correlativo (COT-000001...) debe contar TODAS las cotizaciones de la empresa,
-- aunque el vendedor solo vea las suyas: el trigger corre con permisos del dueño.
alter function public.cotizacion_before_insert() security definer set search_path = public;

notify pgrst, 'reload schema';
