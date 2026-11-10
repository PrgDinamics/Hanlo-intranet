-- =====================================================================
-- Listas de stock de proveedores (formato "STOCK CLIENTES" y AdminPlus)
-- * Stock por color y por proveedor
-- * Precios por volumen: muestra (unitario), por ciento y por millar
-- * Color elegido en cada ítem de la cotización
-- * Margen opcional sobre el precio del proveedor (por empresa)
-- =====================================================================

alter table public.articulos add column if not exists empaque text;   -- ej. "1000 UNID X CAJA"

alter table public.articulo_proveedor
  add column if not exists codigo_proveedor text,
  add column if not exists precio_ciento numeric(14,4) check (precio_ciento is null or precio_ciento >= 0),
  add column if not exists precio_millar numeric(14,4) check (precio_millar is null or precio_millar >= 0),
  add column if not exists desde_ciento  int not null default 50,
  add column if not exists desde_millar  int not null default 500,
  add column if not exists stock         numeric(14,2),
  add column if not exists stock_al      timestamptz;

comment on column public.articulo_proveedor.precio_venta  is 'Precio unitario de muestra (pocas unidades)';
comment on column public.articulo_proveedor.precio_ciento is 'Precio por 100 unidades, desde desde_ciento unidades';
comment on column public.articulo_proveedor.precio_millar is 'Precio por 1000 unidades, desde desde_millar unidades';

create table if not exists public.articulo_proveedor_color (
  id                    uuid primary key default gen_random_uuid(),
  articulo_proveedor_id uuid not null references public.articulo_proveedor(id) on delete cascade,
  color                 text not null,
  stock                 numeric(14,2) not null default 0,
  unique (articulo_proveedor_id, color)
);
create index if not exists apc_ap_idx on public.articulo_proveedor_color(articulo_proveedor_id);

alter table public.articulo_proveedor_color enable row level security;
create policy "lectura autenticados" on public.articulo_proveedor_color for select to authenticated using (true);
create policy "escritura con permiso de articulos" on public.articulo_proveedor_color for all to authenticated
  using (public.puede_crear_articulo()) with check (public.puede_crear_articulo());

alter table public.cotizacion_items add column if not exists color varchar(40);

alter table public.empresas add column if not exists margen_pct numeric(6,2) not null default 0
  check (margen_pct >= 0);
comment on column public.empresas.margen_pct is 'Margen % que se suma al precio del proveedor al cotizar (0 = precio tal cual)';

-- ---------------------------------------------------------------------
-- Stock agregado: colores → proveedor → artículo
-- ---------------------------------------------------------------------
create or replace function public.apc_sumar_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ap uuid := coalesce(new.articulo_proveedor_id, old.articulo_proveedor_id);
begin
  update public.articulo_proveedor
     set stock = (select sum(greatest(stock, 0)) from public.articulo_proveedor_color where articulo_proveedor_id = v_ap),
         stock_al = now()
   where id = v_ap;
  return null;
end $$;

drop trigger if exists t_apc_stock on public.articulo_proveedor_color;
create trigger t_apc_stock after insert or update or delete on public.articulo_proveedor_color
  for each row execute function public.apc_sumar_stock();

create or replace function public.ap_sumar_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_art uuid := coalesce(new.articulo_id, old.articulo_id);
begin
  if tg_op = 'UPDATE' and new.stock is not distinct from old.stock then return null; end if;
  update public.articulos
     set stock_ref = (select sum(stock) from public.articulo_proveedor where articulo_id = v_art and stock is not null)
   where id = v_art
     and exists (select 1 from public.articulo_proveedor where articulo_id = v_art and stock is not null);
  return null;
end $$;

drop trigger if exists t_ap_stock on public.articulo_proveedor;
create trigger t_ap_stock after insert or update of stock or delete on public.articulo_proveedor
  for each row execute function public.ap_sumar_stock();

-- ---------------------------------------------------------------------
-- Funciones de cotización con el color del ítem
-- ---------------------------------------------------------------------
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
    unidad, cantidad, precio_costo, precio_unitario, descuento_pct, color)
  select v_id, (i.ord - 1)::int,
         nullif(i.it->>'articulo_id','')::uuid, nullif(i.it->>'proveedor_id','')::uuid,
         i.it->>'descripcion', nullif(i.it->>'detalle',''), coalesce(nullif(i.it->>'unidad',''), 'Unidad'),
         (i.it->>'cantidad')::numeric, coalesce(nullif(i.it->>'precio_costo','')::numeric, 0),
         (i.it->>'precio_unitario')::numeric, coalesce(nullif(i.it->>'descuento_pct','')::numeric, 0),
         nullif(trim(i.it->>'color'),'')
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
    unidad, cantidad, precio_costo, precio_unitario, descuento_pct, color)
  select v_new, orden, articulo_id, proveedor_id, descripcion, detalle, unidad, cantidad, precio_costo,
         precio_unitario, descuento_pct, color
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
    unidad, cantidad, precio_costo, precio_unitario, descuento_pct, color)
  select v_new, orden, articulo_id, proveedor_id, descripcion, detalle, unidad, cantidad, precio_costo,
         precio_unitario, descuento_pct, color
    from public.cotizacion_items where cotizacion_id = p_id;

  update public.cotizaciones set estado = 'reemplazada' where id = p_id;
  return v_new;
end $$;
