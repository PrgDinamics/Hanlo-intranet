-- =====================================================================
-- Correcciones de la revisión del 10/11/2026
-- A1  Límite de venta: cambiar moneda o T.C. de una emitida también se revisa.
-- A2  Al crear una cotización, la base fija usuario, serie, número, versión, origen e IGV
--     (solo nueva versión y duplicar pueden copiarlos). IGV entre 0 y 100.
-- A3  Precio mínimo (costo más alto de sus proveedores) validado también en la base.
-- A8  Tipo de cambio de la cotización entre 1 y 10.
-- M1  El historial solo lo escribe la base (nadie puede insertar historial a mano).
-- M2  El reporte comercial exige el permiso "reportes".
-- M7  Fechas de cotizaciones y dashboard en hora de Lima.
-- keepalive: la ruta /api/keepalive la llama con la llave secreta.
-- Se puede correr más de una vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A1. Límite de venta al editar una cotización emitida: corre en todo UPDATE
--     y compara el monto en soles (total_para_limite), no solo el total.
-- ---------------------------------------------------------------------
create or replace function public.limite_tras_editar()
returns trigger language plpgsql set search_path = public as $$
declare v_lim numeric;
begin
  if new.estado = 'emitida'
     and public.total_para_limite(new) > public.total_para_limite(old)
     and not public.tiene_permiso('aprobar') then
    select limite_venta into v_lim from public.mis_permisos();
    if v_lim is not null and public.total_para_limite(new) > v_lim then
      raise exception 'Con estos cambios la cotización supera tu límite de S/ %. Vuélvela a borrador y emítela para pedir aprobación.',
        to_char(v_lim, 'FM999,999,990.00');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists t_cot_limite_editar on public.cotizaciones;
create trigger t_cot_limite_editar before update on public.cotizaciones
  for each row execute function public.limite_tras_editar();

-- ---------------------------------------------------------------------
-- A2. Campos que fija la base al crear una cotización
--     usuario_id siempre es quien la crea; serie, número e IGV salen de la empresa
--     (cotizacion_before_insert, que corre después). Solo nueva_version_cotizacion y
--     duplicar_cotizacion los copian, activando la bandera de sesión hanlo.copiando.
-- ---------------------------------------------------------------------
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
    new.usuario_id := auth.uid();
    if coalesce(current_setting('hanlo.copiando', true), '0') <> '1' then
      new.igv_pct := null;
      new.serie := null;
      new.numero := null;
      new.version := 1;
      new.origen_id := null;
    end if;
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

alter table public.cotizaciones drop constraint if exists cotizaciones_igv_pct_check;
alter table public.cotizaciones add constraint cotizaciones_igv_pct_check
  check (igv_pct between 0 and 100) not valid;

-- Nueva versión: copia cabecera e ítems (bandera hanlo.copiando), fecha en hora de Lima
create or replace function public.nueva_version_cotizacion(p_id uuid)
returns uuid language plpgsql security invoker set timezone = 'America/Lima' as $$
declare
  v_old public.cotizaciones;
  v_new uuid;
  v_ver int;
begin
  select * into v_old from public.cotizaciones where id = p_id for update;
  if not found then raise exception 'Cotización no encontrada'; end if;
  if v_old.estado in ('borrador','por_aprobar','anulada','reemplazada','aceptada') then
    raise exception 'No se puede versionar una cotización en estado %', v_old.estado;
  end if;

  select max(version) + 1 into v_ver from public.cotizaciones
   where empresa_id = v_old.empresa_id and serie = v_old.serie and numero = v_old.numero;

  perform set_config('hanlo.copiando', '1', true);
  insert into public.cotizaciones (
    empresa_id, serie, numero, version, origen_id, cliente_id, agente_id, moneda, tipo_cambio,
    forma_pago_id, lugar, fecha_emision, validez_dias, tiempo_entrega, precios_incluyen_igv,
    igv_pct, observaciones, estado)
  values (
    v_old.empresa_id, v_old.serie, v_old.numero, v_ver, v_old.id, v_old.cliente_id, v_old.agente_id,
    v_old.moneda, v_old.tipo_cambio, v_old.forma_pago_id, v_old.lugar, current_date, v_old.validez_dias,
    v_old.tiempo_entrega, v_old.precios_incluyen_igv, v_old.igv_pct, v_old.observaciones, 'borrador')
  returning id into v_new;

  insert into public.cotizacion_items (cotizacion_id, orden, articulo_id, proveedor_id, descripcion, detalle,
    unidad, cantidad, precio_costo, precio_unitario, descuento_pct, color, factor)
  select v_new, orden, articulo_id, proveedor_id, descripcion, detalle, unidad, cantidad, precio_costo,
         precio_unitario, descuento_pct, color, factor
    from public.cotizacion_items where cotizacion_id = p_id;
  perform set_config('hanlo.copiando', '0', true);

  update public.cotizaciones set estado = 'reemplazada' where id = p_id;
  return v_new;
end $$;

-- Duplicar: cotización nueva en borrador con los mismos ítems (bandera hanlo.copiando)
create or replace function public.duplicar_cotizacion(p_id uuid)
returns uuid language plpgsql security invoker set timezone = 'America/Lima' as $$
declare
  v_old public.cotizaciones;
  v_new uuid;
begin
  select * into v_old from public.cotizaciones where id = p_id;
  if not found then raise exception 'Cotización no encontrada'; end if;

  perform set_config('hanlo.copiando', '1', true);
  insert into public.cotizaciones (
    empresa_id, cliente_id, agente_id, moneda, forma_pago_id, lugar, validez_dias, tiempo_entrega,
    precios_incluyen_igv, igv_pct, observaciones)
  values (
    v_old.empresa_id, v_old.cliente_id, v_old.agente_id, v_old.moneda, v_old.forma_pago_id, v_old.lugar,
    v_old.validez_dias, v_old.tiempo_entrega, v_old.precios_incluyen_igv, v_old.igv_pct, v_old.observaciones)
  returning id into v_new;

  insert into public.cotizacion_items (cotizacion_id, orden, articulo_id, proveedor_id, descripcion, detalle,
    unidad, cantidad, precio_costo, precio_unitario, descuento_pct, color, factor)
  select v_new, orden, articulo_id, proveedor_id, descripcion, detalle, unidad, cantidad, precio_costo,
         precio_unitario, descuento_pct, color, factor
    from public.cotizacion_items where cotizacion_id = p_id;
  perform set_config('hanlo.copiando', '0', true);
  return v_new;
end $$;

-- ---------------------------------------------------------------------
-- A3. Precio mínimo del ítem: no menor al costo más alto de sus proveedores
--     Réplica de precioMaximo() (src/lib/precios.ts): tramo muestra / ciento / millar
--     (desde 50 y 500 por defecto), moneda con el T.C. de la cotización, IGV si los
--     precios lo incluyen, 4 decimales y tolerancia 0.00005. Solo ítems del catálogo.
--     No aplica al copiar (nueva versión y duplicar copian precios anteriores).
-- ---------------------------------------------------------------------
create or replace function public.item_precio_minimo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cot record;
  v_max numeric;
begin
  if new.articulo_id is null then return new; end if;
  if coalesce(current_setting('hanlo.copiando', true), '0') = '1' then return new; end if;
  if tg_op = 'UPDATE' and (new.precio_unitario, new.cantidad, new.articulo_id)
     is not distinct from (old.precio_unitario, old.cantidad, old.articulo_id) then
    return new;
  end if;

  select c.moneda, c.tipo_cambio, c.precios_incluyen_igv, c.igv_pct into v_cot
    from public.cotizaciones c where c.id = new.cotizacion_id;
  if not found then return new; end if;

  select max(round(
           (case when ap.moneda <> v_cot.moneda and coalesce(v_cot.tipo_cambio, 0) <> 0 then
                   case when ap.moneda = 'USD' then t.precio * v_cot.tipo_cambio else t.precio / v_cot.tipo_cambio end
                 else t.precio end)
           * (case when v_cot.precios_incluyen_igv then 1 + v_cot.igv_pct / 100 else 1 end), 4))
    into v_max
    from public.articulo_proveedor ap
    cross join lateral (
      select case
        when ap.precio_millar > 0 and new.cantidad >= coalesce(nullif(ap.desde_millar, 0), 500) then ap.precio_millar / 1000
        when ap.precio_ciento > 0 and new.cantidad >= coalesce(nullif(ap.desde_ciento, 0), 50) then ap.precio_ciento / 100
        when ap.precio_venta > 0 then ap.precio_venta
        when ap.precio_ciento > 0 then ap.precio_ciento / 100
        when ap.precio_millar > 0 then ap.precio_millar / 1000
        else 0
      end as precio
    ) t
   where ap.articulo_id = new.articulo_id
     and t.precio > 0;

  if v_max is not null and new.precio_unitario < v_max - 0.00005 then
    raise exception 'Ítem %: para % unidades el precio no puede ser menor al costo más alto de sus proveedores (%). Elige un factor o usa la columna de descuento.',
      new.orden + 1, trim_scale(new.cantidad), trim_scale(v_max);
  end if;
  return new;
end $$;

drop trigger if exists t_items_precio_minimo on public.cotizacion_items;
create trigger t_items_precio_minimo before insert or update on public.cotizacion_items
  for each row execute function public.item_precio_minimo();

-- ---------------------------------------------------------------------
-- A8. Tipo de cambio de la cotización razonable (las filas antiguas no se revisan)
-- ---------------------------------------------------------------------
alter table public.cotizaciones drop constraint if exists cotizaciones_tipo_cambio_check;
alter table public.cotizaciones add constraint cotizaciones_tipo_cambio_check
  check (tipo_cambio is null or tipo_cambio between 1 and 10) not valid;

-- ---------------------------------------------------------------------
-- M1. El historial lo escribe solo el trigger (security definer); sin política de insert
-- ---------------------------------------------------------------------
create or replace function public.cotizacion_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.cotizacion_historial (cotizacion_id, estado_anterior, estado_nuevo, nota)
    values (new.id, null, new.estado,
            case when new.version > 1 then 'Versión ' || new.version || ' creada' else 'Cotización creada' end);
  elsif new.estado is distinct from old.estado then
    insert into public.cotizacion_historial (cotizacion_id, estado_anterior, estado_nuevo, nota)
    values (new.id, old.estado, new.estado,
            case
              when new.estado = 'anulada' then new.motivo_anulacion
              when new.estado = 'por_aprobar' then 'Supera el límite del vendedor, enviada a aprobación'
              when old.estado = 'por_aprobar' and new.estado = 'emitida' then 'Aprobada'
              when old.estado = 'por_aprobar' and new.estado = 'borrador' then 'Devuelta al vendedor sin aprobar'
            end);
  end if;

  if tg_op = 'UPDATE' and (new.precios_incluyen_igv, new.igv_pct) is distinct from (old.precios_incluyen_igv, old.igv_pct) then
    perform public.recalcular_cotizacion(new.id);
  end if;
  return null;
end $$;

drop policy if exists "insertar historial de cotizaciones visibles" on public.cotizacion_historial;

-- ---------------------------------------------------------------------
-- M2. Reporte comercial: exige el permiso "reportes" (también si se llama directo por la API)
-- ---------------------------------------------------------------------
create or replace function public.reporte_comercial(
  p_desde date, p_hasta date, p_empresa uuid default null, p_agente uuid default null)
returns json language plpgsql stable security invoker set jit = off as $$
begin
  if not public.tiene_permiso('reportes') then
    raise exception 'No tienes permiso para ver reportes';
  end if;

  return (
  with base as (
    select c.*,
           case when c.moneda = 'USD' then c.total * coalesce(c.tipo_cambio, 1) else c.total end as total_pen,
           case when c.moneda = 'USD' then c.subtotal * coalesce(c.tipo_cambio, 1) else c.subtotal end as subtotal_pen
      from public.cotizaciones c
     where c.fecha_emision between p_desde and p_hasta
       and (p_empresa is null or c.empresa_id = p_empresa)
       and (p_agente is null or c.agente_id = p_agente)
  ),
  validas as (select * from base where estado not in ('borrador','por_aprobar','anulada','reemplazada')),
  items as (
    select i.*, v.id as cot_id, v.estado, v.cliente_id,
           case when v.moneda = 'USD' then i.importe * coalesce(v.tipo_cambio, 1) else i.importe end as importe_pen,
           case when v.moneda = 'USD' then i.cantidad * i.precio_costo * coalesce(v.tipo_cambio, 1)
                else i.cantidad * i.precio_costo end as costo_pen
      from public.cotizacion_items i join validas v on v.id = i.cotizacion_id
  )
  select json_build_object(
    'resumen', (select json_build_object(
        'cantidad', count(*),
        'cotizado', round(coalesce(sum(total_pen), 0), 2),
        'aceptadas', count(*) filter (where estado = 'aceptada'),
        'aceptado', round(coalesce(sum(total_pen) filter (where estado = 'aceptada'), 0), 2),
        'pendientes', count(*) filter (where estado in ('emitida','entregada')),
        'pendiente', round(coalesce(sum(total_pen) filter (where estado in ('emitida','entregada')), 0), 2),
        'ticket', coalesce(round(avg(total_pen), 2), 0),
        'tasa', case when count(*) filter (where estado in ('aceptada','rechazada','vencida')) = 0 then 0
                     else round(100.0 * count(*) filter (where estado = 'aceptada')
                          / count(*) filter (where estado in ('aceptada','rechazada','vencida')), 1) end,
        'anuladas', (select count(*) from base where estado = 'anulada')
      ) from validas),
    'por_mes', (select coalesce(json_agg(m order by m.mes), '[]'::json) from (
        select to_char(date_trunc('month', fecha_emision), 'YYYY-MM') as mes,
               count(*) as cantidad,
               round(sum(total_pen), 2) as cotizado,
               round(coalesce(sum(total_pen) filter (where estado = 'aceptada'), 0), 2) as aceptado
          from validas group by 1) m),
    'por_estado', (select coalesce(json_agg(e order by e.cantidad desc), '[]'::json) from (
        select estado, count(*) as cantidad, round(sum(total_pen), 2) as monto from base group by estado) e),
    'por_agente', (select coalesce(json_agg(a order by a.cotizado desc), '[]'::json) from (
        select coalesce(ag.nombre, 'Sin agente') as agente,
               count(*) as cantidad,
               round(sum(v.total_pen), 2) as cotizado,
               count(*) filter (where v.estado = 'aceptada') as aceptadas,
               round(coalesce(sum(v.total_pen) filter (where v.estado = 'aceptada'), 0), 2) as aceptado,
               case when count(*) filter (where v.estado in ('aceptada','rechazada','vencida')) = 0 then 0
                    else round(100.0 * count(*) filter (where v.estado = 'aceptada')
                         / count(*) filter (where v.estado in ('aceptada','rechazada','vencida')), 1) end as tasa
          from validas v left join public.agentes ag on ag.id = v.agente_id
         group by ag.nombre) a),
    'por_cliente', (select coalesce(json_agg(x order by x.cotizado desc), '[]'::json) from (
        select cl.id, cl.nombre as cliente, cl.num_doc as documento,
               count(*) as cantidad,
               round(sum(v.total_pen), 2) as cotizado,
               count(*) filter (where v.estado = 'aceptada') as aceptadas,
               round(coalesce(sum(v.total_pen) filter (where v.estado = 'aceptada'), 0), 2) as aceptado,
               max(v.fecha_emision) as ultima
          from validas v join public.clientes cl on cl.id = v.cliente_id
         group by cl.id, cl.nombre, cl.num_doc) x),
    'por_articulo', (select coalesce(json_agg(x order by x.monto desc), '[]'::json) from (
        select coalesce(a.codigo, '(libre)') as codigo,
               coalesce(a.descripcion, min(i.descripcion)) as articulo,
               count(distinct i.cot_id) as cotizaciones,
               round(sum(i.cantidad), 2) as cantidad,
               round(sum(i.importe_pen), 2) as monto,
               round(sum(i.costo_pen), 2) as costo,
               round(coalesce(sum(i.importe_pen) filter (where i.estado = 'aceptada'), 0), 2) as aceptado
          from items i left join public.articulos a on a.id = i.articulo_id
         group by a.codigo, a.descripcion) x),
    'por_proveedor', (select coalesce(json_agg(x order by x.costo desc), '[]'::json) from (
        select coalesce(p.razon_social, 'Sin proveedor') as proveedor, p.ruc,
               count(*) as items,
               round(sum(i.costo_pen), 2) as costo,
               round(coalesce(sum(i.costo_pen) filter (where i.estado = 'aceptada'), 0), 2) as costo_aceptado
          from items i left join public.proveedores p on p.id = i.proveedor_id
         group by p.razon_social, p.ruc) x)
  ));
end $$;

-- ---------------------------------------------------------------------
-- M7. Fechas en hora de Lima (solo dentro de estas funciones; la base sigue en UTC)
-- ---------------------------------------------------------------------
create or replace function public.guardar_cotizacion(p_cab jsonb, p_items jsonb)
returns uuid language plpgsql security invoker set timezone = 'America/Lima' as $$
declare
  v_id uuid := nullif(p_cab->>'id', '')::uuid;
  v_estado text;
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'La cotización debe tener al menos un ítem';
  end if;

  if v_id is null then
    insert into public.cotizaciones (
      empresa_id, cliente_id, agente_id, moneda, tipo_cambio, forma_pago_id, lugar, fecha_emision,
      validez_dias, tiempo_entrega, precios_incluyen_igv, igv_pct, observaciones)
    select (p_cab->>'empresa_id')::uuid, (p_cab->>'cliente_id')::uuid, nullif(p_cab->>'agente_id','')::uuid,
           coalesce(p_cab->>'moneda','PEN'), nullif(p_cab->>'tipo_cambio','')::numeric,
           nullif(p_cab->>'forma_pago_id','')::uuid, coalesce(nullif(p_cab->>'lugar',''), 'Lima'),
           coalesce(nullif(p_cab->>'fecha_emision','')::date, current_date),
           coalesce(nullif(p_cab->>'validez_dias','')::int, 15), nullif(p_cab->>'tiempo_entrega',''),
           coalesce((p_cab->>'precios_incluyen_igv')::boolean, false), e.igv_pct,
           nullif(p_cab->>'observaciones','')
      from public.empresas e where e.id = (p_cab->>'empresa_id')::uuid
    returning id into v_id;
    if v_id is null then raise exception 'Empresa no válida'; end if;
  else
    select estado into v_estado from public.cotizaciones where id = v_id for update;
    if v_estado is null then raise exception 'Cotización no encontrada'; end if;
    if v_estado not in ('borrador','emitida') then
      raise exception 'La cotización está %, no se puede editar. Genere una nueva versión.', v_estado;
    end if;
    update public.cotizaciones set
      cliente_id           = (p_cab->>'cliente_id')::uuid,
      agente_id            = nullif(p_cab->>'agente_id','')::uuid,
      moneda               = coalesce(p_cab->>'moneda','PEN'),
      tipo_cambio          = nullif(p_cab->>'tipo_cambio','')::numeric,
      forma_pago_id        = nullif(p_cab->>'forma_pago_id','')::uuid,
      lugar                = coalesce(nullif(p_cab->>'lugar',''), 'Lima'),
      fecha_emision        = coalesce(nullif(p_cab->>'fecha_emision','')::date, fecha_emision),
      validez_dias         = coalesce(nullif(p_cab->>'validez_dias','')::int, 15),
      tiempo_entrega       = nullif(p_cab->>'tiempo_entrega',''),
      precios_incluyen_igv = coalesce((p_cab->>'precios_incluyen_igv')::boolean, false),
      observaciones        = nullif(p_cab->>'observaciones','')
    where id = v_id;
    delete from public.cotizacion_items where cotizacion_id = v_id;
  end if;

  insert into public.cotizacion_items (cotizacion_id, orden, articulo_id, proveedor_id, descripcion, detalle,
    unidad, cantidad, precio_costo, precio_unitario, descuento_pct, color, factor)
  select v_id, (i.ord - 1)::int,
         nullif(i.it->>'articulo_id','')::uuid, nullif(i.it->>'proveedor_id','')::uuid,
         i.it->>'descripcion', nullif(i.it->>'detalle',''), coalesce(nullif(i.it->>'unidad',''), 'Unidad'),
         (i.it->>'cantidad')::numeric, coalesce(nullif(i.it->>'precio_costo','')::numeric, 0),
         (i.it->>'precio_unitario')::numeric, coalesce(nullif(i.it->>'descuento_pct','')::numeric, 0),
         nullif(trim(i.it->>'color'),''),
         nullif(i.it->>'factor','')::numeric
    from jsonb_array_elements(p_items) with ordinality as i(it, ord);

  perform public.recalcular_cotizacion(v_id);
  return v_id;
end $$;

create or replace function public.dashboard_resumen()
returns json language sql stable security invoker set jit = off set timezone = 'America/Lima' as $$
  select json_build_object(
    'mes_cantidad', (select count(*) from public.cotizaciones
                      where date_trunc('month', fecha_emision) = date_trunc('month', current_date)
                        and estado not in ('anulada','reemplazada')),
    'mes_total_pen', (select coalesce(sum(case when moneda = 'PEN' then total else total * coalesce(tipo_cambio, 1) end), 0)
                      from public.cotizaciones
                      where date_trunc('month', fecha_emision) = date_trunc('month', current_date)
                        and estado not in ('anulada','reemplazada','borrador','por_aprobar')),
    'pendientes', (select count(*) from public.cotizaciones where estado in ('emitida','entregada')),
    'por_aprobar', (select count(*) from public.cotizaciones where estado = 'por_aprobar'),
    'aceptadas_mes', (select count(*) from public.cotizaciones
                      where estado = 'aceptada'
                        and date_trunc('month', fecha_emision) = date_trunc('month', current_date)),
    'tasa_cierre', (select case when count(*) filter (where estado in ('aceptada','rechazada','vencida')) = 0 then 0
                      else round(100.0 * count(*) filter (where estado = 'aceptada')
                           / count(*) filter (where estado in ('aceptada','rechazada','vencida')), 1) end
                      from public.cotizaciones),
    'por_estado', (select coalesce(json_object_agg(estado, n), '{}'::json) from
                    (select estado, count(*) n from public.cotizaciones group by estado) s),
    'por_mes', (select coalesce(json_agg(m order by m.mes), '[]'::json) from (
                  select to_char(d, 'YYYY-MM') as mes,
                         (select count(*) from public.cotizaciones c
                           where date_trunc('month', c.fecha_emision) = d
                             and c.estado not in ('anulada','reemplazada')) as cantidad,
                         (select coalesce(sum(case when moneda = 'PEN' then total else total * coalesce(tipo_cambio,1) end),0)
                            from public.cotizaciones c
                           where date_trunc('month', c.fecha_emision) = d and c.estado = 'aceptada') as aceptado_pen
                    from generate_series(date_trunc('month', current_date) - interval '5 months',
                                         date_trunc('month', current_date), interval '1 month') d) m),
    'clientes', (select count(*) from public.clientes where activo),
    'articulos', (select count(*) from public.articulos where activo),
    'proveedores', (select count(*) from public.proveedores where activo)
  );
$$;

-- ---------------------------------------------------------------------
-- keepalive: la ruta /api/keepalive la llama con la llave secreta (depura la actividad > 12 meses)
-- ---------------------------------------------------------------------
grant execute on function public.keepalive() to service_role;

notify pgrst, 'reload schema';
