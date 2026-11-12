-- =====================================================================
-- INTRANET HANLO · Instalación completa (todas las migraciones en orden)
-- Ejecutar UNA sola vez en Supabase > SQL Editor sobre un proyecto nuevo.
-- =====================================================================


-- >>>>>>>>>> 20261001000000_esquema_inicial.sql
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


-- >>>>>>>>>> 20261001000100_storage.sql
-- Bucket público para fotos de artículos y logos de empresas
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

create policy "media lectura publica" on storage.objects
  for select using (bucket_id = 'media');

create policy "media subir autenticados" on storage.objects
  for insert to authenticated with check (bucket_id = 'media');

create policy "media actualizar autenticados" on storage.objects
  for update to authenticated using (bucket_id = 'media');

create policy "media borrar autenticados" on storage.objects
  for delete to authenticated using (bucket_id = 'media');


-- >>>>>>>>>> 20261002000000_reportes_e_interactividad.sql
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


-- >>>>>>>>>> 20261010000000_permisos_y_aprobaciones.sql
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


-- >>>>>>>>>> 20261019000000_stock_proveedores.sql
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

-- Refrescar la caché de la API
-- ===== 20261020000000_keepalive.sql =====
-- Mantener activo el proyecto (plan gratis de Supabase: se pausa tras 7 días sin uso).
-- Se llama desde un cron (cPanel o Vercel) con la llave publicable; no expone datos.
create or replace function public.keepalive()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object('ok', true, 'empresas', (select count(*) from public.empresas), 'en', now());
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

-- ===== 20261025000000_factores_y_recargos.sql =====
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

notify pgrst, 'reload schema';

-- ===== 20261027000000_visibilidad_por_agente.sql =====
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

-- ===== 20261028000000_stock_al_emitir_y_actividad.sql =====
-- =====================================================================
-- 1. Revisión de stock al emitir (con los datos más recientes de las listas)
-- 2. Registro de actividad: quién cambió qué en clientes, artículos, precios
--    y configuración. Liviano: solo guarda los campos que cambiaron y
--    se depura solo (más de 12 meses).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Ítems de una cotización sin stock suficiente
--    Con color: stock de ese color (en el proveedor elegido, o en todos).
--    Sin color: stock del proveedor elegido (o de todos).
--    Artículos sin stock registrado no se revisan.
-- ---------------------------------------------------------------------
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
grant execute on function public.revisar_stock(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Registro de actividad
-- ---------------------------------------------------------------------
create table if not exists public.actividad (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  usuario_id  uuid,
  usuario     text,
  tabla       text not null,
  registro_id uuid,
  registro    text,
  accion      text not null check (accion in ('crear', 'editar', 'eliminar', 'importar')),
  cambios     jsonb
);
create index if not exists actividad_fecha_idx on public.actividad (created_at desc);
create index if not exists actividad_tabla_idx on public.actividad (tabla, created_at desc);

alter table public.actividad enable row level security;
drop policy if exists "actividad solo admin" on public.actividad;
create policy "actividad solo admin" on public.actividad for select to authenticated using (public.es_admin());

-- Columnas que no interesa registrar (automáticas o de stock, que cambian con cada lista)
create or replace function public.actividad_ignorar()
returns text[] language sql immutable as $$
  select array['created_at', 'updated_at', 'stock', 'stock_al', 'stock_ref', 'id']::text[];
$$;

create or replace function public.registrar_actividad()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_cambios jsonb := '{}'::jsonb;
  v_k text;
  v_nombre text;
  v_usuario text;
begin
  -- Importaciones masivas: no se registra fila por fila (el importador deja un resumen).
  -- Solo vale para administradores, así nadie más puede saltarse el registro.
  if coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json ->> 'x-sin-actividad' = '1'
     and public.es_admin() then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    for v_k in select jsonb_object_keys(v_new) loop
      if v_k = any(public.actividad_ignorar()) then continue; end if;
      if (v_new -> v_k) is distinct from (v_old -> v_k) then
        v_cambios := v_cambios || jsonb_build_object(v_k, jsonb_build_array(v_old -> v_k, v_new -> v_k));
      end if;
    end loop;
    if v_cambios = '{}'::jsonb then return null; end if; -- nada relevante cambió
  end if;

  -- Nombre legible del registro
  if tg_table_name = 'articulo_proveedor' then
    select a.codigo || ' · ' || p.razon_social into v_nombre
      from public.articulos a, public.proveedores p
     where a.id = (v_row ->> 'articulo_id')::uuid and p.id = (v_row ->> 'proveedor_id')::uuid;
  end if;
  v_nombre := coalesce(v_nombre,
    nullif(concat_ws(' · ', v_row ->> 'codigo', v_row ->> 'descripcion'), ''),
    v_row ->> 'razon_social', v_row ->> 'nombre', v_row ->> 'email',
    v_row ->> 'fecha');

  select coalesce(nullif(p.nombre, ''), p.email) into v_usuario from public.perfiles p where p.id = auth.uid();

  insert into public.actividad (usuario_id, usuario, tabla, registro_id, registro, accion, cambios)
  values (
    auth.uid(),
    coalesce(v_usuario, case when auth.uid() is null then 'Sistema' end),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    left(v_nombre, 200),
    case tg_op when 'INSERT' then 'crear' when 'UPDATE' then 'editar' else 'eliminar' end,
    case when tg_op = 'UPDATE' then v_cambios end
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['clientes', 'articulos', 'proveedores', 'articulo_proveedor', 'lineas',
                           'empresas', 'agentes', 'perfiles', 'formas_pago', 'tipos_cambio']
  loop
    execute format('drop trigger if exists t_actividad on public.%I', t);
    execute format('create trigger t_actividad after insert or update or delete on public.%I
                    for each row execute function public.registrar_actividad()', t);
  end loop;
end $$;

-- Resumen de una importación (una sola fila en el registro)
create or replace function public.registrar_importacion(p_registro text, p_resumen text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.es_admin() then return; end if;
  insert into public.actividad (usuario_id, usuario, tabla, registro, accion, cambios)
  select auth.uid(), coalesce(nullif(p.nombre, ''), p.email), 'importaciones', left(p_registro, 200), 'importar',
         jsonb_build_object('resumen', to_jsonb(p_resumen))
    from public.perfiles p where p.id = auth.uid();
end $$;
grant execute on function public.registrar_importacion(text, text[]) to authenticated;

-- Depuración automática: se llama desde el cron diario (keepalive)
create or replace function public.keepalive()
returns json language plpgsql security definer set search_path = public as $$
begin
  delete from public.actividad where created_at < now() - interval '12 months';
  return json_build_object('ok', true, 'empresas', (select count(*) from public.empresas), 'en', now());
end $$;
grant execute on function public.keepalive() to anon, authenticated;

notify pgrst, 'reload schema';

-- ===================================================================== 20261029000000_tipo_cambio_fuente
-- Origen de cada tipo de cambio: traído de SUNAT (automático) o registrado a mano
alter table public.tipos_cambio
  add column if not exists fuente text not null default 'manual' check (fuente in ('manual', 'sunat'));

notify pgrst, 'reload schema';

-- ===================================================================== 20261030000000_igv_por_proveedor
-- Cada proveedor recuerda si sus listas de stock traen los precios con IGV o sin IGV.
-- null = todavía no se definió (se pregunta en la primera importación).
alter table public.proveedores
  add column if not exists precios_incluyen_igv boolean;

notify pgrst, 'reload schema';

-- ===================================================================== 20261103000000_blindaje
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

-- ===================================================================== 20261104000000_roles
-- =====================================================================
-- Roles configurables (4/11/2026)
-- El administrador crea roles y marca qué puede hacer cada uno.
-- "Administrador" es fijo: tiene todo y no se edita ni se borra.
-- Crear clientes, crear artículos y el límite de venta siguen también en el agente comercial
-- (un usuario puede hacerlo si su rol O su agente se lo permiten).
-- Usuarios, roles y agentes (límites) los maneja solo el Administrador.
-- =====================================================================

create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  descripcion text,
  sistema     boolean not null default false,  -- el rol Administrador
  permisos    text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Permisos disponibles (los mismos que muestra la pantalla de Roles)
create or replace function public.permisos_validos()
returns text[] language sql immutable as $$
  select array['cotizaciones_todas', 'aprobar', 'clientes', 'articulos', 'importar',
               'tipos_cambio', 'formas_pago', 'empresas', 'reportes', 'actividad']::text[];
$$;

alter table public.roles drop constraint if exists roles_permisos_check;
alter table public.roles add constraint roles_permisos_check check (permisos <@ public.permisos_validos());

insert into public.roles (nombre, descripcion, sistema, permisos) values
  ('Administrador', 'Gerencia: puede todo, ve reportes y administra usuarios, roles y agentes.', true, public.permisos_validos()),
  ('Vendedor', 'Cotiza y ve solo sus cotizaciones. Crear clientes o artículos y su límite vienen de su agente.', false, '{}'),
  ('Coordinador', 'Opera el día a día: catálogo, precios, Excel, tipo de cambio; ve todas las cotizaciones y aprueba.', false,
   array['cotizaciones_todas', 'aprobar', 'clientes', 'articulos', 'importar', 'tipos_cambio', 'formas_pago'])
on conflict (nombre) do nothing;

-- El rol Administrador siempre conserva todos los permisos
create or replace function public.roles_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.sistema then raise exception 'El rol Administrador no se puede eliminar'; end if;
    if exists (select 1 from public.perfiles where rol_id = old.id) then
      raise exception 'Hay usuarios con el rol "%". Cámbialos de rol antes de eliminarlo.', old.nombre;
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.sistema then
    new.sistema := true;
    new.permisos := public.permisos_validos();
    new.nombre := old.nombre;
  elsif tg_op = 'INSERT' then
    new.sistema := false;  -- solo existe un rol de sistema
  end if;
  new.permisos := array(select distinct unnest(new.permisos) order by 1);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists t_roles_guard on public.roles;
create trigger t_roles_guard before insert or update or delete on public.roles
  for each row execute function public.roles_guard();

-- Cada usuario tiene un rol. "rol" (admin / vendedor) se mantiene sincronizado para lo que ya existía.
alter table public.perfiles add column if not exists rol_id uuid references public.roles(id);
update public.perfiles p set rol_id = r.id
  from public.roles r
 where p.rol_id is null and r.nombre = case when p.rol = 'admin' then 'Administrador' else 'Vendedor' end;

create or replace function public.perfiles_sync_rol()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rol_id is not null and (tg_op = 'INSERT' or new.rol_id is distinct from old.rol_id) then
    new.rol := case when (select sistema from public.roles where id = new.rol_id) then 'admin' else 'vendedor' end;
  elsif tg_op = 'INSERT' or new.rol is distinct from old.rol or new.rol_id is null then
    select id into new.rol_id from public.roles
     where (new.rol = 'admin' and sistema) or (new.rol <> 'admin' and nombre = 'Vendedor')
     order by sistema desc limit 1;
  end if;
  return new;
end $$;
drop trigger if exists a_perfiles_sync_rol on public.perfiles;
create trigger a_perfiles_sync_rol before insert or update on public.perfiles
  for each row execute function public.perfiles_sync_rol();

-- ¿El usuario de la sesión tiene este permiso? (activo; el Administrador siempre)
create or replace function public.tiene_permiso(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.perfiles u join public.roles r on r.id = u.rol_id
     where u.id = auth.uid() and u.activo and (r.sistema or p = any(r.permisos))
  );
$$;
grant execute on function public.tiene_permiso(text) to authenticated;

-- Permisos del usuario para la intranet (lista de su rol)
create or replace function public.mis_permisos_rol()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select case when r.sistema then public.permisos_validos() else r.permisos end
                     from public.perfiles u join public.roles r on r.id = u.rol_id
                    where u.id = auth.uid() and u.activo), '{}');
$$;
grant execute on function public.mis_permisos_rol() to authenticated;

-- Crear clientes / artículos: lo permite el rol o el agente
create or replace function public.mis_permisos()
returns table (es_admin boolean, crea_cliente boolean, crea_articulo boolean, limite_venta numeric, agente_id uuid)
language sql stable security definer set search_path = public as $$
  select p.rol = 'admin',
         p.rol = 'admin' or coalesce(a.crea_cliente, false) or 'clientes' = any(coalesce(r.permisos, '{}')),
         p.rol = 'admin' or coalesce(a.crea_articulo, false) or 'articulos' = any(coalesce(r.permisos, '{}')),
         case when p.rol = 'admin' then null else a.limite_venta end,
         p.agente_id
    from public.perfiles p
    left join public.agentes a on a.id = p.agente_id and a.activo
    left join public.roles r on r.id = p.rol_id
   where p.id = auth.uid() and p.activo;
$$;

-- Roles: todos los activos los leen (para mostrar el nombre); solo el Administrador los cambia
alter table public.roles enable row level security;
drop policy if exists "roles lectura" on public.roles;
create policy "roles lectura" on public.roles for select to authenticated using ((select public.es_activo()));
drop policy if exists "roles escritura admin" on public.roles;
create policy "roles escritura admin" on public.roles for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

-- Configuración según permiso
drop policy if exists "escritura admin" on public.empresas;
create policy "escritura admin" on public.empresas for all to authenticated
  using ((select public.tiene_permiso('empresas'))) with check ((select public.tiene_permiso('empresas')));
drop policy if exists "escritura admin" on public.formas_pago;
create policy "escritura admin" on public.formas_pago for all to authenticated
  using ((select public.tiene_permiso('formas_pago'))) with check ((select public.tiene_permiso('formas_pago')));
drop policy if exists "escritura admin" on public.tipos_cambio;
create policy "escritura admin" on public.tipos_cambio for all to authenticated
  using ((select public.tiene_permiso('tipos_cambio'))) with check ((select public.tiene_permiso('tipos_cambio')));
drop policy if exists "actividad solo admin" on public.actividad;
create policy "actividad solo admin" on public.actividad for select to authenticated
  using ((select public.tiene_permiso('actividad')));

-- Excel de importación
drop policy if exists "importaciones admin subir" on storage.objects;
drop policy if exists "importaciones admin leer" on storage.objects;
drop policy if exists "importaciones admin borrar" on storage.objects;
create policy "importaciones admin subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'importaciones' and public.tiene_permiso('importar'));
create policy "importaciones admin leer" on storage.objects for select to authenticated
  using (bucket_id = 'importaciones' and public.tiene_permiso('importar'));
create policy "importaciones admin borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'importaciones' and public.tiene_permiso('importar'));

-- Fotos y logos: con permiso de artículos o de empresas
drop policy if exists "media subir autenticados" on storage.objects;
drop policy if exists "media actualizar autenticados" on storage.objects;
drop policy if exists "media borrar autenticados" on storage.objects;
create policy "media subir autenticados" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (public.puede_crear_articulo() or public.tiene_permiso('empresas')));
create policy "media actualizar autenticados" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (public.puede_crear_articulo() or public.tiene_permiso('empresas')));
create policy "media borrar autenticados" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (public.puede_crear_articulo() or public.tiene_permiso('empresas')));

create or replace function public.registrar_importacion(p_registro text, p_resumen text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.tiene_permiso('importar') then return; end if;
  insert into public.actividad (usuario_id, usuario, tabla, registro, accion, cambios)
  select auth.uid(), coalesce(nullif(p.nombre, ''), p.email), 'importaciones', left(p_registro, 200), 'importar',
         jsonb_build_object('resumen', to_jsonb(p_resumen))
    from public.perfiles p where p.id = auth.uid();
end $$;

create or replace function public.registrar_actividad()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_cambios jsonb := '{}'::jsonb;
  v_k text;
  v_nombre text;
  v_usuario text;
begin
  -- Importaciones masivas: no se registra fila por fila (el importador deja un resumen).
  -- Solo vale para quien tiene permiso de importar, así nadie más puede saltarse el registro.
  if coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json ->> 'x-sin-actividad' = '1'
     and public.tiene_permiso('importar') then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    for v_k in select jsonb_object_keys(v_new) loop
      if v_k = any(public.actividad_ignorar()) then continue; end if;
      if (v_new -> v_k) is distinct from (v_old -> v_k) then
        v_cambios := v_cambios || jsonb_build_object(v_k, jsonb_build_array(v_old -> v_k, v_new -> v_k));
      end if;
    end loop;
    if v_cambios = '{}'::jsonb then return null; end if; -- nada relevante cambió
  end if;

  -- Nombre legible del registro
  if tg_table_name = 'articulo_proveedor' then
    select a.codigo || ' · ' || p.razon_social into v_nombre
      from public.articulos a, public.proveedores p
     where a.id = (v_row ->> 'articulo_id')::uuid and p.id = (v_row ->> 'proveedor_id')::uuid;
  end if;
  v_nombre := coalesce(v_nombre,
    nullif(concat_ws(' · ', v_row ->> 'codigo', v_row ->> 'descripcion'), ''),
    v_row ->> 'razon_social', v_row ->> 'nombre', v_row ->> 'email',
    v_row ->> 'fecha');

  select coalesce(nullif(p.nombre, ''), p.email) into v_usuario from public.perfiles p where p.id = auth.uid();

  insert into public.actividad (usuario_id, usuario, tabla, registro_id, registro, accion, cambios)
  values (
    auth.uid(),
    coalesce(v_usuario, case when auth.uid() is null then 'Sistema' end),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    left(v_nombre, 200),
    case tg_op when 'INSERT' then 'crear' when 'UPDATE' then 'editar' else 'eliminar' end,
    case when tg_op = 'UPDATE' then v_cambios end
  );
  return null;
end $$;


-- Ver todas las cotizaciones: permiso "cotizaciones_todas"
create or replace function public.ve_cotizacion(p_usuario uuid, p_agente uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.tiene_permiso('cotizaciones_todas') or exists (
    select 1 from public.perfiles p
     where p.id = auth.uid() and p.activo
       and (p_usuario = auth.uid() or (p.agente_id is not null and p.agente_id = p_agente))
  );
$$;

-- Asignar la cotización a cualquier agente: quien ve todas las cotizaciones
create or replace function public.agente_permitido(p_agente uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.tiene_permiso('cotizaciones_todas') or exists (
    select 1 from public.perfiles p
     where p.id = auth.uid() and p.activo and (p_agente is null or p.agente_id = p_agente)
  );
$$;

drop policy if exists "ver cotizaciones propias" on public.cotizaciones;
create policy "ver cotizaciones propias" on public.cotizaciones for select to authenticated
  using (
    (select public.tiene_permiso('cotizaciones_todas'))
    or ((select public.es_activo())
        and (usuario_id = (select auth.uid()) or agente_id = (select public.mi_agente())))
  );
drop policy if exists "actualizar cotizaciones propias" on public.cotizaciones;
create policy "actualizar cotizaciones propias" on public.cotizaciones for update to authenticated
  using (
    (select public.tiene_permiso('cotizaciones_todas'))
    or ((select public.es_activo())
        and (usuario_id = (select auth.uid()) or agente_id = (select public.mi_agente())))
  )
  with check (
    ((select public.tiene_permiso('cotizaciones_todas'))
     or ((select public.es_activo())
         and (usuario_id = (select auth.uid()) or agente_id = (select public.mi_agente()))))
    and public.agente_permitido(agente_id)
  );
drop policy if exists "crear cotizaciones propias" on public.cotizaciones;
create policy "crear cotizaciones propias" on public.cotizaciones for insert to authenticated
  with check (public.agente_permitido(agente_id)
              and (usuario_id = (select auth.uid()) or (select public.tiene_permiso('cotizaciones_todas'))));

-- Aprobar y emitir sobre el límite: permiso "aprobar"
create or replace function public.supera_limite(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not public.tiene_permiso('aprobar') and coalesce(
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
     and not public.tiene_permiso('aprobar') then
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
  v_aprueba boolean := public.tiene_permiso('aprobar');
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

    -- Aprueba quien tiene el permiso "aprobar"
    if old.estado = 'por_aprobar' and new.estado = 'emitida' and not v_aprueba then
      raise exception 'Solo quien tiene permiso de aprobar puede aprobar esta cotización';
    end if;

    -- Sin permiso de aprobar no se emite por encima del límite propio
    if new.estado = 'emitida' and old.estado = 'borrador' and not v_aprueba then
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

-- Registro de actividad también para roles
drop trigger if exists t_actividad on public.roles;
create trigger t_actividad after insert or update or delete on public.roles
  for each row execute function public.registrar_actividad();

notify pgrst, 'reload schema';

-- ===== 20261110000000_correcciones_revision.sql =====
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

-- ===== 20261111000000_impresion_y_opciones.sql =====
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

-- ===== 20261112000000_permiso_revistas.sql =====
-- =====================================================================
-- Permiso "revistas" (12/11/2026): publicar, ocultar y eliminar revistas virtuales
-- en hanloinnova.com/revistas. Se asigna en Configuración > Roles y permisos.
-- El rol Administrador (fijo) lo tiene siempre. Se puede correr más de una vez.
-- =====================================================================

create or replace function public.permisos_validos()
returns text[] language sql immutable as $$
  select array['cotizaciones_todas', 'aprobar', 'clientes', 'articulos', 'importar',
               'tipos_cambio', 'formas_pago', 'empresas', 'reportes', 'actividad', 'revistas']::text[];
$$;

-- La restricción usa la función: se vuelve a crear para que acepte el permiso nuevo
alter table public.roles drop constraint if exists roles_permisos_check;
alter table public.roles add constraint roles_permisos_check check (permisos <@ public.permisos_validos());

-- El Administrador queda con todos los permisos, incluido el nuevo
update public.roles set permisos = public.permisos_validos() where sistema;

notify pgrst, 'reload schema';
