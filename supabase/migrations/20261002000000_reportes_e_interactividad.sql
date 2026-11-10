-- =====================================================================
-- Reportes, historial de precios por cliente y correlativo inicial
-- =====================================================================

-- Para continuar la numeración que la empresa ya usaba antes del sistema
alter table public.empresas add column if not exists correlativo_inicial int not null default 0;

create or replace function public.cotizacion_before_insert()
returns trigger language plpgsql as $$
declare
  v_emp public.empresas;
begin
  select * into v_emp from public.empresas where id = new.empresa_id;
  if new.serie is null then new.serie := v_emp.serie; end if;
  if new.igv_pct is null then new.igv_pct := v_emp.igv_pct; end if;

  if new.numero is null then
    perform pg_advisory_xact_lock(hashtext(new.empresa_id::text || new.serie));
    select greatest(coalesce(max(numero), 0), coalesce(v_emp.correlativo_inicial, 0)) + 1 into new.numero
      from public.cotizaciones
     where empresa_id = new.empresa_id and serie = new.serie;
  end if;

  if new.tipo_cambio is null then
    select venta into new.tipo_cambio from public.tipos_cambio
     where fecha <= new.fecha_emision order by fecha desc limit 1;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Reporte comercial: todo en soles (USD convertido con el T.C. de cada cotización)
-- "Cotizado" = emitida en adelante (sin borradores, anuladas ni reemplazadas)
-- ---------------------------------------------------------------------
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
  validas as (select * from base where estado not in ('borrador','anulada','reemplazada')),
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
grant execute on function public.reporte_comercial(date, date, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Último precio cotizado a un cliente por artículo (para el editor)
-- ---------------------------------------------------------------------
create or replace function public.ultimos_precios_cliente(p_cliente uuid)
returns table (articulo_id uuid, precio_unitario numeric, moneda char(3), fecha date, codigo text, estado text)
language sql stable security invoker as $$
  select distinct on (i.articulo_id)
         i.articulo_id, i.precio_unitario, c.moneda, c.fecha_emision,
         c.serie || '-' || lpad(c.numero::text, 6, '0') || case when c.version > 1 then ' v' || c.version else '' end,
         c.estado
    from public.cotizacion_items i
    join public.cotizaciones c on c.id = i.cotizacion_id
   where c.cliente_id = p_cliente
     and i.articulo_id is not null
     and c.estado not in ('borrador','anulada','reemplazada')
   order by i.articulo_id, c.fecha_emision desc, c.created_at desc;
$$;
grant execute on function public.ultimos_precios_cliente(uuid) to authenticated;
