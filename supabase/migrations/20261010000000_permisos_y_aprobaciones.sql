-- =====================================================================
-- Requerimientos del cliente (archivo "Información para cargar a la BD - MERCH")
-- * Agentes de venta con permisos: crea cliente, crea artículo, límite S/ de venta
-- * Cotizaciones que superan el límite del vendedor pasan a "Por aprobar"
-- * Contacto con documento, cargo y correo en clientes y proveedores
-- * Unidades libres (Juego, Unidad, Caja...)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columnas nuevas
-- ---------------------------------------------------------------------
alter table public.agentes
  add column if not exists num_doc       varchar(15),
  add column if not exists crea_cliente  boolean not null default false,
  add column if not exists crea_articulo boolean not null default false,
  add column if not exists limite_venta  numeric(14,2) check (limite_venta is null or limite_venta >= 0);

comment on column public.agentes.limite_venta is 'Monto máximo en soles que el vendedor puede emitir sin aprobación. NULL = sin límite';

alter table public.proveedores
  add column if not exists contacto_doc   varchar(15),
  add column if not exists contacto_cargo text,
  add column if not exists contacto_email text;

alter table public.clientes
  add column if not exists contacto_doc varchar(15);

alter table public.articulos alter column unidad type varchar(20);
alter table public.cotizacion_items alter column unidad type varchar(20);

-- Unidad por defecto más legible
alter table public.articulos alter column unidad set default 'Unidad';

-- ---------------------------------------------------------------------
-- Nuevo estado "por_aprobar"
-- ---------------------------------------------------------------------
alter table public.cotizaciones drop constraint if exists cotizaciones_estado_check;
alter table public.cotizaciones add constraint cotizaciones_estado_check
  check (estado in ('borrador','por_aprobar','emitida','entregada','aceptada','rechazada','vencida','anulada','reemplazada'));

-- ---------------------------------------------------------------------
-- Permisos del usuario actual (vienen del agente vinculado a su perfil)
-- Admin: todo permitido y sin límite.
-- ---------------------------------------------------------------------
create or replace function public.mis_permisos()
returns table (es_admin boolean, crea_cliente boolean, crea_articulo boolean, limite_venta numeric, agente_id uuid)
language sql stable security definer set search_path = public as $$
  select p.rol = 'admin',
         p.rol = 'admin' or coalesce(a.crea_cliente, false),
         p.rol = 'admin' or coalesce(a.crea_articulo, false),
         case when p.rol = 'admin' then null else a.limite_venta end,
         p.agente_id
    from public.perfiles p
    left join public.agentes a on a.id = p.agente_id and a.activo
   where p.id = auth.uid() and p.activo;
$$;
grant execute on function public.mis_permisos() to authenticated;

create or replace function public.puede_crear_cliente()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select crea_cliente from public.mis_permisos()), false);
$$;

create or replace function public.puede_crear_articulo()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select crea_articulo from public.mis_permisos()), false);
$$;

-- Total de una cotización expresado en soles
create or replace function public.total_en_soles(c public.cotizaciones)
returns numeric language sql immutable as $$
  select case when c.moneda = 'USD' then c.total * coalesce(c.tipo_cambio, 1) else c.total end;
$$;

-- ¿La cotización supera el límite del usuario actual?
create or replace function public.supera_limite(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select public.total_en_soles(c) > m.limite_venta
       from public.cotizaciones c, public.mis_permisos() m
      where c.id = p_id and m.limite_venta is not null),
    false);
$$;
grant execute on function public.supera_limite(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RLS por permiso (reemplaza "escritura autenticados" en maestros)
-- ---------------------------------------------------------------------
drop policy if exists "escritura autenticados" on public.clientes;
drop policy if exists "escritura autenticados" on public.articulos;
drop policy if exists "escritura autenticados" on public.articulo_proveedor;
drop policy if exists "escritura autenticados" on public.lineas;
drop policy if exists "escritura autenticados" on public.proveedores;

create policy "escritura con permiso de clientes" on public.clientes for all to authenticated
  using (public.puede_crear_cliente()) with check (public.puede_crear_cliente());
create policy "escritura con permiso de articulos" on public.articulos for all to authenticated
  using (public.puede_crear_articulo()) with check (public.puede_crear_articulo());
create policy "escritura con permiso de articulos" on public.articulo_proveedor for all to authenticated
  using (public.puede_crear_articulo()) with check (public.puede_crear_articulo());
create policy "escritura con permiso de articulos" on public.lineas for all to authenticated
  using (public.puede_crear_articulo()) with check (public.puede_crear_articulo());
create policy "escritura con permiso de articulos" on public.proveedores for all to authenticated
  using (public.puede_crear_articulo()) with check (public.puede_crear_articulo());

-- ---------------------------------------------------------------------
-- Transiciones de estado con aprobación
-- ---------------------------------------------------------------------
create or replace function public.cotizacion_estado_guard()
returns trigger language plpgsql as $$
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
      if v_lim is not null and public.total_en_soles(new) > v_lim then
        raise exception 'La cotización supera tu límite de S/ % y requiere aprobación', to_char(v_lim, 'FM999,999,990.00');
      end if;
    end if;
  end if;

  -- cabecera bloqueada fuera de borrador/emitida (salvo cambio de estado)
  if tg_op = 'UPDATE' and old.estado not in ('borrador','emitida') and new.estado = old.estado then
    if (new.cliente_id, new.moneda, new.forma_pago_id, new.fecha_emision, new.empresa_id)
       is distinct from (old.cliente_id, old.moneda, old.forma_pago_id, old.fecha_emision, old.empresa_id) then
      raise exception 'La cotización está %, no se puede modificar. Genere una nueva versión.', old.estado;
    end if;
  end if;
  return new;
end $$;

-- Historial: notas para aprobaciones
create or replace function public.cotizacion_after_change()
returns trigger language plpgsql as $$
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

-- Emitir: decide entre "emitida" y "por_aprobar" según el límite del usuario
create or replace function public.emitir_cotizacion(p_id uuid)
returns text language plpgsql security invoker as $$
declare
  v_estado text;
  v_nuevo text;
begin
  select estado into v_estado from public.cotizaciones where id = p_id;
  if v_estado is null then raise exception 'Cotización no encontrada'; end if;
  if v_estado <> 'borrador' then raise exception 'Solo se emiten cotizaciones en borrador'; end if;
  v_nuevo := case when public.supera_limite(p_id) then 'por_aprobar' else 'emitida' end;
  update public.cotizaciones set estado = v_nuevo where id = p_id;
  return v_nuevo;
end $$;
grant execute on function public.emitir_cotizacion(uuid) to authenticated;

-- No versionar cotizaciones por aprobar
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
    unidad, cantidad, precio_costo, precio_unitario, descuento_pct)
  select v_new, orden, articulo_id, proveedor_id, descripcion, detalle, unidad, cantidad, precio_costo,
         precio_unitario, descuento_pct
    from public.cotizacion_items where cotizacion_id = p_id;

  update public.cotizaciones set estado = 'reemplazada' where id = p_id;
  return v_new;
end $$;

-- Editar una cotización ya emitida no puede dejarla por encima del límite del vendedor
create or replace function public.limite_tras_editar()
returns trigger language plpgsql as $$
declare v_lim numeric;
begin
  if new.estado = 'emitida' and new.total is distinct from old.total and new.total > old.total
     and not public.es_admin() then
    select limite_venta into v_lim from public.mis_permisos();
    if v_lim is not null and public.total_en_soles(new) > v_lim then
      raise exception 'Con estos cambios la cotización supera tu límite de S/ %. Vuélvela a borrador y emítela para pedir aprobación.',
        to_char(v_lim, 'FM999,999,990.00');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists t_cot_limite_editar on public.cotizaciones;
create trigger t_cot_limite_editar before update of total on public.cotizaciones
  for each row execute function public.limite_tras_editar();

-- ---------------------------------------------------------------------
-- Dashboard y reportes: "por aprobar" no cuenta como emitida
-- ---------------------------------------------------------------------
create or replace function public.dashboard_resumen()
returns json language sql stable security invoker as $$
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

-- Reporte comercial: excluye cotizaciones por aprobar
create or replace function public.reporte_comercial(
  p_desde date, p_hasta date, p_empresa uuid default null, p_agente uuid default null)
returns json language sql stable security invoker as $$
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
  );
$$;

-- ---------------------------------------------------------------------
-- Bucket privado para los Excel de importación (pueden traer muchas fotos)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('importaciones', 'importaciones', false)
on conflict (id) do nothing;

create policy "importaciones admin subir" on storage.objects
  for insert to authenticated with check (bucket_id = 'importaciones' and public.es_admin());
create policy "importaciones admin leer" on storage.objects
  for select to authenticated using (bucket_id = 'importaciones' and public.es_admin());
create policy "importaciones admin borrar" on storage.objects
  for delete to authenticated using (bucket_id = 'importaciones' and public.es_admin());
