-- =====================================================================
-- Cotizaciones: impresión del logo (11/11/2026)
-- 1. Cada ítem indica cuántos colores o impresiones lleva el logo en cada producto (0, 1, 2...).
--    Impresiones totales = cantidad del ítem × colores (2,000 und × 1 color = 2,000 impresiones).
--    Cada impresión cuesta lo que diga la empresa (por defecto S/ 0.50) y se suma al costo del
--    producto ANTES del factor: precio = (costo + colores × S/ 0.50) ÷ factor.
-- 2. El descuento por ítem deja de usarse en la pantalla (la columna se conserva en 0).
-- Se puede correr más de una vez. Si se corrió la versión anterior de este archivo
-- (impresión con unidad y líneas de opción), esta la reemplaza y quita esas columnas.
-- =====================================================================

alter table public.empresas add column if not exists costo_impresion numeric(10,4) not null default 0.50;
alter table public.empresas drop constraint if exists empresas_costo_impresion_check;
alter table public.empresas add constraint empresas_costo_impresion_check check (costo_impresion >= 0);
comment on column public.empresas.costo_impresion is 'Costo de una impresión de logo (S/), se suma al costo antes del factor';

alter table public.cotizacion_items add column if not exists impresion_colores smallint not null default 0;
alter table public.cotizacion_items drop constraint if exists cotizacion_items_impresion_colores_check;
alter table public.cotizacion_items add constraint cotizacion_items_impresion_colores_check
  check (impresion_colores between 0 and 20);
comment on column public.cotizacion_items.impresion_colores is 'Colores o impresiones del logo por producto (impresiones = cantidad × colores)';

-- Totales: suma de todos los ítems (deja la versión de siempre)
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

-- Guardar con la impresión
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
    unidad, cantidad, precio_costo, precio_unitario, descuento_pct, color, factor, impresion_colores)
  select v_id, (i.ord - 1)::int,
         nullif(i.it->>'articulo_id','')::uuid, nullif(i.it->>'proveedor_id','')::uuid,
         i.it->>'descripcion', nullif(i.it->>'detalle',''), coalesce(nullif(i.it->>'unidad',''), 'Unidad'),
         (i.it->>'cantidad')::numeric, coalesce(nullif(i.it->>'precio_costo','')::numeric, 0),
         (i.it->>'precio_unitario')::numeric, coalesce(nullif(i.it->>'descuento_pct','')::numeric, 0),
         nullif(trim(i.it->>'color'),''),
         nullif(i.it->>'factor','')::numeric,
         coalesce(nullif(i.it->>'impresion_colores','')::smallint, 0)
    from jsonb_array_elements(p_items) with ordinality as i(it, ord);

  perform public.recalcular_cotizacion(v_id);
  return v_id;
end $$;

-- Nueva versión y duplicar copian también la impresión
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
    unidad, cantidad, precio_costo, precio_unitario, descuento_pct, color, factor, impresion_colores)
  select v_new, orden, articulo_id, proveedor_id, descripcion, detalle, unidad, cantidad, precio_costo,
         precio_unitario, descuento_pct, color, factor, impresion_colores
    from public.cotizacion_items where cotizacion_id = p_id;
  perform set_config('hanlo.copiando', '0', true);

  update public.cotizaciones set estado = 'reemplazada' where id = p_id;
  return v_new;
end $$;

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
    unidad, cantidad, precio_costo, precio_unitario, descuento_pct, color, factor, impresion_colores)
  select v_new, orden, articulo_id, proveedor_id, descripcion, detalle, unidad, cantidad, precio_costo,
         precio_unitario, descuento_pct, color, factor, impresion_colores
    from public.cotizacion_items where cotizacion_id = p_id;
  perform set_config('hanlo.copiando', '0', true);
  return v_new;
end $$;

-- Precio mínimo: costo más alto del proveedor + impresión (colores × costo por impresión)
create or replace function public.item_precio_minimo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cot record;
  v_max numeric;
  v_imp numeric := 0;
  v_hay_prov boolean;
begin
  if new.articulo_id is null then return new; end if;
  if coalesce(current_setting('hanlo.copiando', true), '0') = '1' then return new; end if;
  if tg_op = 'UPDATE' and (new.precio_unitario, new.cantidad, new.articulo_id, new.impresion_colores)
     is not distinct from (old.precio_unitario, old.cantidad, old.articulo_id, old.impresion_colores) then
    return new;
  end if;

  select c.moneda, c.tipo_cambio, c.precios_incluyen_igv, c.igv_pct, coalesce(e.costo_impresion, 0) as costo_impresion into v_cot
    from public.cotizaciones c left join public.empresas e on e.id = c.empresa_id where c.id = new.cotizacion_id;
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
  v_hay_prov := v_max is not null;

  -- Impresión del logo por producto: colores × costo por impresión,
  -- en la moneda de la cotización y con IGV si los precios lo incluyen
  if coalesce(new.impresion_colores, 0) > 0 then
    v_imp := new.impresion_colores * v_cot.costo_impresion;
    if v_cot.moneda = 'USD' then
      -- En dólares se convierte con el T.C. de la cotización (sin T.C. el servidor ya no deja guardar)
      v_imp := case when coalesce(v_cot.tipo_cambio, 0) > 0 then v_imp / v_cot.tipo_cambio else 0 end;
    end if;
    -- Mismo redondeo que la pantalla y el servidor: 4 decimales antes del IGV
    v_imp := round(v_imp, 4);
    if v_cot.precios_incluyen_igv then v_imp := v_imp * (1 + v_cot.igv_pct / 100); end if;
    v_max := round(coalesce(v_max, 0) + v_imp, 4);
  end if;

  if v_max is not null and v_max > 0 and new.precio_unitario < v_max - 0.00005 then
    raise exception 'Ítem %: para % unidades el precio no puede ser menor al costo (%: %). %',
      new.orden + 1, trim_scale(new.cantidad),
      case when v_hay_prov and coalesce(v_imp, 0) > 0 then 'proveedor más alto e impresión'
           when v_hay_prov then 'proveedor más alto' else 'impresión del logo' end,
      trim_scale(v_max),
      case when v_hay_prov then 'Sube el precio o elige un factor.' else 'Sube el precio.' end;
  end if;
  return new;
end $$;

-- Revisión de stock al emitir (deja la versión de siempre)
create or replace function public.revisar_stock(p_id uuid)
returns table (orden int, descripcion text, color text, cantidad numeric, disponible numeric)
language sql stable security invoker set search_path = public as $$
  select i.orden, i.descripcion, i.color, i.cantidad, d.disp
    from public.cotizacion_items i
    cross join lateral (
      select case
        when i.color is not null then (
          select sum(greatest(c.stock, 0))
            from public.articulo_proveedor ap
            join public.articulo_proveedor_color c on c.articulo_proveedor_id = ap.id
           where ap.articulo_id = i.articulo_id
             and (i.proveedor_id is null or ap.proveedor_id = i.proveedor_id)
             and upper(c.color) = upper(i.color))
        else (
          select sum(greatest(ap.stock, 0))
            from public.articulo_proveedor ap
           where ap.articulo_id = i.articulo_id
             and (i.proveedor_id is null or ap.proveedor_id = i.proveedor_id)
             and ap.stock is not null)
      end as disp
    ) d
   where i.cotizacion_id = p_id
     and i.articulo_id is not null
     and d.disp is not null
     and d.disp < i.cantidad
   order by i.orden;
$$;

-- Reporte comercial (deja la versión de siempre)
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

-- Columnas de la versión anterior de este archivo (impresión con unidad y líneas de opción)
alter table public.cotizacion_items drop column if exists impresion_cant;
alter table public.cotizacion_items drop column if exists impresion_unidad;
alter table public.cotizacion_items drop column if exists es_opcion;

notify pgrst, 'reload schema';
