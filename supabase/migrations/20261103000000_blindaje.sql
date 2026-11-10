-- =====================================================================
-- Blindaje encontrado en las pruebas de error (3/11/2026)
-- 1. Una cuenta creada desde fuera (registro libre de Supabase) ya no nace admin ni activa.
-- 2. Solo los usuarios activos de la intranet pueden leer datos.
-- 3. Totales, correlativo e IGV de una cotización solo los calcula la base.
-- 4. El límite de venta usa el tipo de cambio oficial (no el que se escriba a mano).
-- 5. Ítems sin descripción, fotos y logos solo los cambia quien tiene permiso.
-- =====================================================================

-- 1. Usuarios nuevos: siempre vendedor e inactivo. El admin los activa desde Usuarios
--    (y crear-admin.mjs crea al administrador ya activo).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, email, nombre, rol, activo)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    'vendedor',
    false
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- 2. Lectura solo para usuarios activos.
--    "(select ...)" hace que la verificación se calcule una vez por consulta y no por cada fila.
create or replace function public.es_activo()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and activo);
$$;
grant execute on function public.es_activo() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['agentes', 'articulo_proveedor', 'articulo_proveedor_color', 'articulos', 'clientes',
                           'empresas', 'formas_pago', 'lineas', 'proveedores', 'tipos_cambio']
  loop
    execute format('drop policy if exists "lectura autenticados" on public.%I', t);
    execute format('create policy "lectura autenticados" on public.%I for select to authenticated using ((select public.es_activo()))', t);
  end loop;
end $$;
drop policy if exists "lectura autenticados" on public.perfiles;
create policy "lectura autenticados" on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or (select public.es_activo()));

drop policy if exists "actividad solo admin" on public.actividad;
create policy "actividad solo admin" on public.actividad for select to authenticated using ((select public.es_admin()));

-- Cotizaciones visibles: misma regla que ve_cotizacion(), escrita para calcularse una vez por consulta
-- (con miles de cotizaciones, llamar la función fila por fila hacía lento el dashboard y las listas)
create or replace function public.mi_agente()
returns uuid language sql stable security definer set search_path = public as $$
  select agente_id from public.perfiles where id = auth.uid() and activo;
$$;
grant execute on function public.mi_agente() to authenticated;

drop policy if exists "ver cotizaciones propias" on public.cotizaciones;
create policy "ver cotizaciones propias" on public.cotizaciones for select to authenticated
  using (
    (select public.es_admin())
    or ((select public.es_activo())
        and (usuario_id = (select auth.uid()) or agente_id = (select public.mi_agente())))
  );
drop policy if exists "actualizar cotizaciones propias" on public.cotizaciones;
create policy "actualizar cotizaciones propias" on public.cotizaciones for update to authenticated
  using (
    (select public.es_admin())
    or ((select public.es_activo())
        and (usuario_id = (select auth.uid()) or agente_id = (select public.mi_agente())))
  )
  with check (
    ((select public.es_admin())
     or ((select public.es_activo())
         and (usuario_id = (select auth.uid()) or agente_id = (select public.mi_agente()))))
    and public.agente_permitido(agente_id)
  );

-- 3. Campos que solo calcula la base
create or replace function public.recalcular_cotizacion(p_id uuid)
returns void language plpgsql set search_path = public as $$
declare
  v_suma numeric(14,2);
  v_cot  public.cotizaciones;
begin
  select * into v_cot from public.cotizaciones where id = p_id;
  if not found then return; end if;
  select coalesce(sum(importe), 0) into v_suma from public.cotizacion_items where cotizacion_id = p_id;

  perform set_config('hanlo.recalculando', '1', true);
  if v_cot.precios_incluyen_igv then
    update public.cotizaciones set
      total    = v_suma,
      subtotal = round(v_suma / (1 + igv_pct / 100), 2),
      igv      = v_suma - round(v_suma / (1 + igv_pct / 100), 2)
    where id = p_id;
  else
    update public.cotizaciones set
      subtotal = v_suma,
      igv      = round(v_suma * igv_pct / 100, 2),
      total    = v_suma + round(v_suma * igv_pct / 100, 2)
    where id = p_id;
  end if;
  perform set_config('hanlo.recalculando', '0', true);
end $$;

create or replace function public.cotizacion_proteger()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- Toda cotización nace en borrador y en cero: los totales salen de sus ítems
    if new.estado <> 'borrador' then
      raise exception 'Una cotización nueva siempre empieza en borrador';
    end if;
    new.subtotal := 0;
    new.igv := 0;
    new.total := 0;
    return new;
  end if;

  if coalesce(current_setting('hanlo.recalculando', true), '0') <> '1' then
    new.subtotal := old.subtotal;
    new.igv := old.igv;
    new.total := old.total;
  end if;
  new.empresa_id := old.empresa_id;
  new.serie := old.serie;
  new.numero := old.numero;
  new.version := old.version;
  new.origen_id := old.origen_id;
  new.usuario_id := old.usuario_id;
  new.created_at := old.created_at;
  if not public.es_admin() then
    new.igv_pct := old.igv_pct;
  end if;
  return new;
end $$;

drop trigger if exists t_cot_proteger on public.cotizaciones;
-- El nombre empieza con "a" para correr antes que los demás BEFORE (se ejecutan en orden alfabético)
drop trigger if exists a_cot_proteger on public.cotizaciones;
create trigger a_cot_proteger before insert or update on public.cotizaciones
  for each row execute function public.cotizacion_proteger();

-- 4. Para el límite de venta, un monto en dólares se convierte con el T.C. oficial más reciente
--    (o el de la cotización si es mayor), así no se puede bajar el monto escribiendo otro T.C.
create or replace function public.total_para_limite(c public.cotizaciones)
returns numeric language sql stable set search_path = public as $$
  select case when c.moneda = 'USD'
    then c.total * greatest(
      coalesce(c.tipo_cambio, 0),
      coalesce((select venta from public.tipos_cambio order by fecha desc limit 1), 0),
      1)
    else c.total end;
$$;

create or replace function public.supera_limite(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select public.total_para_limite(c) > m.limite_venta
       from public.cotizaciones c, public.mis_permisos() m
      where c.id = p_id and m.limite_venta is not null),
    false);
$$;

create or replace function public.limite_tras_editar()
returns trigger language plpgsql set search_path = public as $$
declare v_lim numeric;
begin
  if new.estado = 'emitida' and new.total is distinct from old.total and new.total > old.total
     and not public.es_admin() then
    select limite_venta into v_lim from public.mis_permisos();
    if v_lim is not null and public.total_para_limite(new) > v_lim then
      raise exception 'Con estos cambios la cotización supera tu límite de S/ %. Vuélvela a borrador y emítela para pedir aprobación.',
        to_char(v_lim, 'FM999,999,990.00');
    end if;
  end if;
  return new;
end $$;

create or replace function public.cotizacion_estado_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  permitido boolean;
  v_admin boolean := public.es_admin();
  v_lim numeric;
begin
  if tg_op = 'UPDATE' and new.estado is distinct from old.estado then
    permitido := case old.estado
      when 'borrador'    then new.estado in ('emitida','por_aprobar','anulada')
      when 'por_aprobar' then new.estado in ('emitida','borrador','anulada')
      when 'emitida'     then new.estado in ('entregada','aceptada','rechazada','vencida','anulada','reemplazada','borrador')
      when 'entregada'   then new.estado in ('aceptada','rechazada','vencida','anulada','reemplazada')
      when 'aceptada'    then new.estado in ('anulada')
      when 'rechazada'   then new.estado in ('reemplazada')
      when 'vencida'     then new.estado in ('reemplazada')
      else false
    end;
    if not permitido then
      raise exception 'Transición de estado no permitida: % → %', old.estado, new.estado;
    end if;
    if new.estado = 'anulada' and coalesce(trim(new.motivo_anulacion), '') = '' then
      raise exception 'Debe indicar el motivo de anulación';
    end if;

    -- Solo un administrador aprueba
    if old.estado = 'por_aprobar' and new.estado = 'emitida' and not v_admin then
      raise exception 'Solo un administrador puede aprobar esta cotización';
    end if;

    -- Un vendedor no puede emitir por encima de su límite
    if new.estado = 'emitida' and old.estado = 'borrador' and not v_admin then
      select limite_venta into v_lim from public.mis_permisos();
      if v_lim is not null and public.total_para_limite(new) > v_lim then
        raise exception 'La cotización supera tu límite de S/ % y requiere aprobación', to_char(v_lim, 'FM999,999,990.00');
      end if;
    end if;
  end if;

  -- cabecera bloqueada fuera de borrador/emitida (salvo cambio de estado)
  if tg_op = 'UPDATE' and old.estado not in ('borrador','emitida') and new.estado = old.estado then
    if (new.cliente_id, new.moneda, new.forma_pago_id, new.fecha_emision, new.empresa_id, new.tipo_cambio)
       is distinct from (old.cliente_id, old.moneda, old.forma_pago_id, old.fecha_emision, old.empresa_id, old.tipo_cambio) then
      raise exception 'La cotización está %, no se puede modificar. Genere una nueva versión.', old.estado;
    end if;
  end if;
  return new;
end $$;

-- 5a. Ítems con descripción (las filas antiguas no se revisan)
alter table public.cotizacion_items drop constraint if exists cotizacion_items_descripcion_check;
alter table public.cotizacion_items add constraint cotizacion_items_descripcion_check
  check (length(trim(descripcion)) > 0) not valid;

-- 5b. Fotos de artículos y logos: subir, cambiar o borrar solo con permiso de artículos (el admin siempre)
drop policy if exists "media subir autenticados" on storage.objects;
drop policy if exists "media actualizar autenticados" on storage.objects;
drop policy if exists "media borrar autenticados" on storage.objects;
create policy "media subir autenticados" on storage.objects
  for insert to authenticated with check (bucket_id = 'media' and public.puede_crear_articulo());
create policy "media actualizar autenticados" on storage.objects
  for update to authenticated using (bucket_id = 'media' and public.puede_crear_articulo());
create policy "media borrar autenticados" on storage.objects
  for delete to authenticated using (bucket_id = 'media' and public.puede_crear_articulo());

-- 6. Rendimiento: el dashboard y el reporte juntan muchas consultas pequeñas; el compilador JIT de Postgres
--    tardaba ~1 s en "optimizarlas" para un trabajo de 25 ms. Se apaga solo para estas dos funciones.
alter function public.dashboard_resumen() set jit = off;
alter function public.reporte_comercial(date, date, uuid, uuid) set jit = off;

-- 5c. Tipo de cambio razonable (evita 376 en vez de 3.76). Las filas antiguas no se revisan
alter table public.tipos_cambio drop constraint if exists tipos_cambio_rango_check;
alter table public.tipos_cambio add constraint tipos_cambio_rango_check
  check (compra between 1 and 10 and venta between 1 and 10) not valid;

notify pgrst, 'reload schema';
