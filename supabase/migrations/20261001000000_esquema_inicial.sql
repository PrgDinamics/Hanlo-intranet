-- =====================================================================
-- HANLO INTRANET · Gestión de Cotizaciones Comerciales
-- Esquema inicial: tablas del sistema, maestros, cotizaciones, RLS
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- TABLAS DEL SISTEMA
-- ---------------------------------------------------------------------
create table public.empresas (
  id              uuid primary key default gen_random_uuid(),
  razon_social    text not null,
  nombre_comercial text,
  ruc             varchar(11) not null unique check (ruc ~ '^[0-9]{11}$'),
  direccion       text,
  telefono        text,
  email           text,
  web             text,
  logo_url        text,
  serie           varchar(10) not null default 'COT',
  igv_pct         numeric(5,2) not null default 18,
  pie_cotizacion  text,            -- condiciones / cuentas bancarias impresas
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.agentes (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  email       text,
  telefono    text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.perfiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null default '',
  email       text,
  rol         text not null default 'vendedor' check (rol in ('admin','vendedor')),
  agente_id   uuid references public.agentes(id) on delete set null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.tipos_cambio (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null unique,
  compra      numeric(10,4) not null check (compra > 0),
  venta       numeric(10,4) not null check (venta > 0),
  created_at  timestamptz not null default now()
);

create table public.formas_pago (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null unique,
  dias_credito  int not null default 0 check (dias_credito >= 0),
  activo        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- MAESTROS
-- ---------------------------------------------------------------------
create table public.lineas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  descripcion text,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.articulos (
  id            uuid primary key default gen_random_uuid(),
  codigo        varchar(30) not null unique,
  descripcion   text not null,
  detalle       text,
  unidad        varchar(10) not null default 'UND',
  linea_id      uuid references public.lineas(id) on delete set null,
  foto_url      text,
  stock_ref     numeric(12,2),
  activo        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index articulos_linea_idx on public.articulos(linea_id);
create index articulos_desc_idx on public.articulos using gin (to_tsvector('spanish', descripcion));

create table public.proveedores (
  id                uuid primary key default gen_random_uuid(),
  ruc               varchar(11) not null unique check (ruc ~ '^[0-9]{11}$'),
  razon_social      text not null,
  direccion         text,
  telefono          text,
  email             text,
  contacto_nombre   text,
  contacto_telefono text,
  linea_credito     numeric(14,2) not null default 0,
  moneda_credito    char(3) not null default 'PEN' check (moneda_credito in ('PEN','USD')),
  notas             text,
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Qué proveedor ofrece qué artículo y a qué precio
create table public.articulo_proveedor (
  id             uuid primary key default gen_random_uuid(),
  articulo_id    uuid not null references public.articulos(id) on delete cascade,
  proveedor_id   uuid not null references public.proveedores(id) on delete cascade,
  precio_compra  numeric(14,4) not null default 0 check (precio_compra >= 0),
  precio_venta   numeric(14,4) not null default 0 check (precio_venta >= 0),
  moneda         char(3) not null default 'PEN' check (moneda in ('PEN','USD')),
  preferido      boolean not null default false,
  updated_at     timestamptz not null default now(),
  unique (articulo_id, proveedor_id)
);
create index ap_proveedor_idx on public.articulo_proveedor(proveedor_id);

create table public.clientes (
  id                 uuid primary key default gen_random_uuid(),
  tipo_persona       text not null default 'juridica' check (tipo_persona in ('natural','juridica')),
  tipo_doc           text not null default 'RUC' check (tipo_doc in ('RUC','DNI','CE','PAS')),
  num_doc            varchar(15) not null,
  nombre             text not null,       -- razón social o nombres completos
  direccion          text,
  telefono           text,
  email              text,
  contacto_nombre    text,
  contacto_cargo     text,
  contacto_telefono  text,
  contacto_email     text,
  categoria          text not null default 'potencial' check (categoria in ('regular','potencial','inactivo')),
  agente_id          uuid references public.agentes(id) on delete set null,
  notas              text,
  activo             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tipo_doc, num_doc),
  check (tipo_doc <> 'RUC' or num_doc ~ '^[0-9]{11}$'),
  check (tipo_doc <> 'DNI' or num_doc ~ '^[0-9]{8}$')
);

-- ---------------------------------------------------------------------
-- COTIZACIONES
-- ---------------------------------------------------------------------
create table public.cotizaciones (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null references public.empresas(id),
  serie                 varchar(10) not null,
  numero                int not null,
  version               int not null default 1,
  origen_id             uuid references public.cotizaciones(id),
  cliente_id            uuid not null references public.clientes(id),
  agente_id             uuid references public.agentes(id),
  usuario_id            uuid references auth.users(id) default auth.uid(),
  moneda                char(3) not null default 'PEN' check (moneda in ('PEN','USD')),
  tipo_cambio           numeric(10,4),
  forma_pago_id         uuid references public.formas_pago(id),
  lugar                 text not null default 'Lima',
  fecha_emision         date not null default current_date,
  validez_dias          int not null default 15 check (validez_dias >= 0),
  tiempo_entrega        text,
  precios_incluyen_igv  boolean not null default false,
  igv_pct               numeric(5,2) not null default 18,
  subtotal              numeric(14,2) not null default 0,
  igv                   numeric(14,2) not null default 0,
  total                 numeric(14,2) not null default 0,
  estado                text not null default 'borrador'
                        check (estado in ('borrador','emitida','entregada','aceptada','rechazada','vencida','anulada','reemplazada')),
  observaciones         text,
  motivo_anulacion      text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (empresa_id, serie, numero, version)
);
create index cot_cliente_idx on public.cotizaciones(cliente_id);
create index cot_estado_idx on public.cotizaciones(estado);
create index cot_fecha_idx on public.cotizaciones(fecha_emision desc);

create table public.cotizacion_items (
  id               uuid primary key default gen_random_uuid(),
  cotizacion_id    uuid not null references public.cotizaciones(id) on delete cascade,
  orden            int not null default 0,
  articulo_id      uuid references public.articulos(id) on delete set null,
  proveedor_id     uuid references public.proveedores(id) on delete set null,
  descripcion      text not null,       -- copia congelada del catálogo
  detalle          text,
  unidad           varchar(10) not null default 'UND',
  cantidad         numeric(12,2) not null default 1 check (cantidad > 0),
  precio_costo     numeric(14,4) not null default 0,
  precio_unitario  numeric(14,4) not null default 0 check (precio_unitario >= 0),
  descuento_pct    numeric(5,2) not null default 0 check (descuento_pct between 0 and 100),
  importe          numeric(14,2) generated always as
                   (round(cantidad * precio_unitario * (1 - descuento_pct / 100), 2)) stored
);
create index items_cot_idx on public.cotizacion_items(cotizacion_id);

create table public.cotizacion_historial (
  id               uuid primary key default gen_random_uuid(),
  cotizacion_id    uuid not null references public.cotizaciones(id) on delete cascade,
  estado_anterior  text,
  estado_nuevo     text not null,
  nota             text,
  usuario_id       uuid default auth.uid(),
  created_at       timestamptz not null default now()
);
create index hist_cot_idx on public.cotizacion_historial(cotizacion_id);

-- ---------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------
create trigger t_upd before update on public.empresas    for each row execute function public.set_updated_at();
create trigger t_upd before update on public.agentes     for each row execute function public.set_updated_at();
create trigger t_upd before update on public.perfiles    for each row execute function public.set_updated_at();
create trigger t_upd before update on public.articulos   for each row execute function public.set_updated_at();
create trigger t_upd before update on public.proveedores for each row execute function public.set_updated_at();
create trigger t_upd before update on public.articulo_proveedor for each row execute function public.set_updated_at();
create trigger t_upd before update on public.clientes    for each row execute function public.set_updated_at();
create trigger t_upd before update on public.cotizaciones for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Perfil automático al crear un usuario (el primero queda como admin)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, email, nombre, rol)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.perfiles) then
      coalesce(new.raw_user_meta_data->>'rol', 'vendedor')
    else 'admin' end
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfiles where id = auth.uid() and rol = 'admin' and activo
  );
$$;

-- ---------------------------------------------------------------------
-- Cotizaciones: correlativo, totales, estados
-- ---------------------------------------------------------------------

-- Asigna serie y número correlativo por empresa al insertar
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
    select coalesce(max(numero), 0) + 1 into new.numero
      from public.cotizaciones
     where empresa_id = new.empresa_id and serie = new.serie;
  end if;

  if new.tipo_cambio is null then
    select venta into new.tipo_cambio from public.tipos_cambio
     where fecha <= new.fecha_emision order by fecha desc limit 1;
  end if;
  return new;
end $$;

create trigger t_cot_before_insert before insert on public.cotizaciones
  for each row execute function public.cotizacion_before_insert();

-- Recalcula totales de la cabecera
create or replace function public.recalcular_cotizacion(p_id uuid)
returns void language plpgsql as $$
declare
  v_suma numeric(14,2);
  v_cot  public.cotizaciones;
begin
  select * into v_cot from public.cotizaciones where id = p_id;
  if not found then return; end if;
  select coalesce(sum(importe), 0) into v_suma from public.cotizacion_items where cotizacion_id = p_id;

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
end $$;

create or replace function public.items_after_change()
returns trigger language plpgsql as $$
begin
  perform public.recalcular_cotizacion(coalesce(new.cotizacion_id, old.cotizacion_id));
  return null;
end $$;

create trigger t_items_after_change
  after insert or update or delete on public.cotizacion_items
  for each row execute function public.items_after_change();

-- Solo se pueden editar ítems en borrador o emitida
create or replace function public.items_guard()
returns trigger language plpgsql as $$
declare v_estado text;
begin
  select estado into v_estado from public.cotizaciones
   where id = coalesce(new.cotizacion_id, old.cotizacion_id);
  if v_estado is not null and v_estado not in ('borrador','emitida') then
    raise exception 'La cotización está %, no se pueden modificar sus ítems. Genere una nueva versión.', v_estado;
  end if;
  return coalesce(new, old);
end $$;

create trigger t_items_guard
  before insert or update or delete on public.cotizacion_items
  for each row execute function public.items_guard();

-- Transiciones de estado válidas + historial
create or replace function public.cotizacion_estado_guard()
returns trigger language plpgsql as $$
declare
  permitido boolean;
begin
  if tg_op = 'UPDATE' and new.estado is distinct from old.estado then
    permitido := case old.estado
      when 'borrador'  then new.estado in ('emitida','anulada')
      when 'emitida'   then new.estado in ('entregada','aceptada','rechazada','vencida','anulada','reemplazada','borrador')
      when 'entregada' then new.estado in ('aceptada','rechazada','vencida','anulada','reemplazada')
      when 'aceptada'  then new.estado in ('anulada')
      when 'rechazada' then new.estado in ('reemplazada')
      when 'vencida'   then new.estado in ('reemplazada')
      else false
    end;
    if not permitido then
      raise exception 'Transición de estado no permitida: % → %', old.estado, new.estado;
    end if;
    if new.estado = 'anulada' and coalesce(trim(new.motivo_anulacion), '') = '' then
      raise exception 'Debe indicar el motivo de anulación';
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

create trigger t_cot_estado_guard before update on public.cotizaciones
  for each row execute function public.cotizacion_estado_guard();

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
            case when new.estado = 'anulada' then new.motivo_anulacion end);
  end if;

  if tg_op = 'UPDATE' and (new.precios_incluyen_igv, new.igv_pct) is distinct from (old.precios_incluyen_igv, old.igv_pct) then
    perform public.recalcular_cotizacion(new.id);
  end if;
  return null;
end $$;

create trigger t_cot_after_change after insert or update on public.cotizaciones
  for each row execute function public.cotizacion_after_change();

-- Nueva versión: copia cabecera e ítems, marca la anterior como reemplazada
create or replace function public.nueva_version_cotizacion(p_id uuid)
returns uuid language plpgsql security invoker as $$
declare
  v_old public.cotizaciones;
  v_new uuid;
  v_ver int;
begin
  select * into v_old from public.cotizaciones where id = p_id for update;
  if not found then raise exception 'Cotización no encontrada'; end if;
  if v_old.estado in ('borrador','anulada','reemplazada','aceptada') then
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

-- Duplicar como cotización nueva (otro cliente u otra fecha), siempre en borrador
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
    unidad, cantidad, precio_costo, precio_unitario, descuento_pct)
  select v_new, orden, articulo_id, proveedor_id, descripcion, detalle, unidad, cantidad, precio_costo,
         precio_unitario, descuento_pct
    from public.cotizacion_items where cotizacion_id = p_id;
  return v_new;
end $$;

-- Vista con código legible y nombres para listados
create or replace view public.v_cotizaciones with (security_invoker = true) as
select c.*,
       c.serie || '-' || lpad(c.numero::text, 6, '0') ||
         case when c.version > 1 then ' v' || c.version else '' end as codigo,
       c.fecha_emision + c.validez_dias as fecha_vencimiento,
       cl.nombre  as cliente_nombre,
       cl.num_doc as cliente_doc,
       e.razon_social as empresa_nombre,
       a.nombre as agente_nombre,
       fp.nombre as forma_pago_nombre
  from public.cotizaciones c
  join public.clientes cl on cl.id = c.cliente_id
  join public.empresas e  on e.id = c.empresa_id
  left join public.agentes a on a.id = c.agente_id
  left join public.formas_pago fp on fp.id = c.forma_pago_id;

-- Resumen para el dashboard
create or replace function public.dashboard_resumen()
returns json language sql stable security invoker as $$
  select json_build_object(
    'mes_cantidad', (select count(*) from public.cotizaciones
                      where date_trunc('month', fecha_emision) = date_trunc('month', current_date)
                        and estado not in ('anulada','reemplazada')),
    'mes_total_pen', (select coalesce(sum(case when moneda = 'PEN' then total else total * coalesce(tipo_cambio, 1) end), 0)
                      from public.cotizaciones
                      where date_trunc('month', fecha_emision) = date_trunc('month', current_date)
                        and estado not in ('anulada','reemplazada','borrador')),
    'pendientes', (select count(*) from public.cotizaciones where estado in ('emitida','entregada')),
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
-- RLS
-- ---------------------------------------------------------------------
alter table public.empresas            enable row level security;
alter table public.agentes             enable row level security;
alter table public.perfiles            enable row level security;
alter table public.tipos_cambio        enable row level security;
alter table public.formas_pago         enable row level security;
alter table public.lineas              enable row level security;
alter table public.articulos           enable row level security;
alter table public.proveedores         enable row level security;
alter table public.articulo_proveedor  enable row level security;
alter table public.clientes            enable row level security;
alter table public.cotizaciones        enable row level security;
alter table public.cotizacion_items    enable row level security;
alter table public.cotizacion_historial enable row level security;

-- Lectura: cualquier usuario autenticado
do $$
declare t text;
begin
  foreach t in array array['empresas','agentes','perfiles','tipos_cambio','formas_pago','lineas','articulos',
                           'proveedores','articulo_proveedor','clientes','cotizaciones','cotizacion_items',
                           'cotizacion_historial']
  loop
    execute format('create policy "lectura autenticados" on public.%I for select to authenticated using (true)', t);
  end loop;

  -- Escritura libre para usuarios autenticados en el día a día
  foreach t in array array['lineas','articulos','proveedores','articulo_proveedor','clientes','cotizacion_items']
  loop
    execute format('create policy "escritura autenticados" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;

  -- Tablas del sistema: solo admin
  foreach t in array array['empresas','agentes','tipos_cambio','formas_pago','perfiles']
  loop
    execute format('create policy "escritura admin" on public.%I for all to authenticated using (public.es_admin()) with check (public.es_admin())', t);
  end loop;
end $$;

-- Cotizaciones: crear y actualizar sí, borrar nunca (se anulan)
create policy "insertar cotizaciones" on public.cotizaciones for insert to authenticated with check (true);
create policy "actualizar cotizaciones" on public.cotizaciones for update to authenticated using (true) with check (true);
create policy "insertar historial" on public.cotizacion_historial for insert to authenticated with check (true);

grant execute on function public.dashboard_resumen() to authenticated;
grant execute on function public.nueva_version_cotizacion(uuid) to authenticated;
grant execute on function public.duplicar_cotizacion(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Guardar cotización completa (cabecera + ítems) en una sola transacción
-- p_cab: { id?, empresa_id, cliente_id, agente_id, moneda, tipo_cambio, forma_pago_id, lugar,
--          fecha_emision, validez_dias, tiempo_entrega, precios_incluyen_igv, observaciones }
-- p_items: [{ articulo_id, proveedor_id, descripcion, detalle, unidad, cantidad,
--             precio_costo, precio_unitario, descuento_pct }]
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
    unidad, cantidad, precio_costo, precio_unitario, descuento_pct)
  select v_id, (i.ord - 1)::int,
         nullif(i.it->>'articulo_id','')::uuid, nullif(i.it->>'proveedor_id','')::uuid,
         i.it->>'descripcion', nullif(i.it->>'detalle',''), coalesce(nullif(i.it->>'unidad',''), 'UND'),
         (i.it->>'cantidad')::numeric, coalesce(nullif(i.it->>'precio_costo','')::numeric, 0),
         (i.it->>'precio_unitario')::numeric, coalesce(nullif(i.it->>'descuento_pct','')::numeric, 0)
    from jsonb_array_elements(p_items) with ordinality as i(it, ord);

  perform public.recalcular_cotizacion(v_id);
  return v_id;
end $$;

grant execute on function public.guardar_cotizacion(jsonb, jsonb) to authenticated;
