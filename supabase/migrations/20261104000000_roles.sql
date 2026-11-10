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
