-- =====================================================================
-- Precio de venta = costo del proveedor ÷ factor (0.60, 0.75, 0.77, 0.80...)
-- y recargo opcional según la forma de pago (ej. factura a 60 días +5%).
-- =====================================================================

-- Factores que se ofrecen al cotizar (por empresa), separados por coma
alter table public.empresas
  add column if not exists factores text not null default '0.60, 0.75, 0.77, 0.80';

-- Recargo % sobre el precio de venta según la forma de pago
alter table public.formas_pago
  add column if not exists recargo_pct numeric(5,2) not null default 0
    check (recargo_pct >= 0 and recargo_pct <= 100);

-- Factor con el que se calculó el precio del ítem (informativo, no se imprime)
alter table public.cotizacion_items
  add column if not exists factor numeric(6,4) check (factor is null or (factor > 0 and factor <= 1));

-- Formas de pago típicas (si no existen)
insert into public.formas_pago (nombre, dias_credito, recargo_pct) values
  ('Contado', 0, 0),
  ('Factura a 30 días', 30, 0),
  ('Factura a 60 días', 60, 5),
  ('Factura a 90 días', 90, 5)
on conflict (nombre) do nothing;

-- Funciones de cotización: guardan y copian el factor del ítem
create or replace function public.guardar_cotizacion(p_cab jsonb, p_items jsonb)
returns uuid language plpgsql security invoker as $$
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

create or replace function public.duplicar_cotizacion(p_id uuid)
returns uuid language plpgsql security invoker as $$
declare
  v_old public.cotizaciones;
  v_new uuid;
begin
  select * into v_old from public.cotizaciones where id = p_id;
  if not found then raise exception 'Cotización no encontrada'; end if;

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
  return v_new;
end $$;

create or replace function public.nueva_version_cotizacion(p_id uuid)
returns uuid language plpgsql security invoker as $$
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

  update public.cotizaciones set estado = 'reemplazada' where id = p_id;
  return v_new;
end $$;
