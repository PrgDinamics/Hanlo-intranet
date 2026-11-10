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
