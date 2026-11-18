-- =====================================================================
-- Pedidos de la reunión con Hanlo (18/11/2026). Se puede correr más de una vez.
-- 1. Tipo de cambio fijo por empresa (estándar 3.40), sin módulo de tipos de cambio ni SUNAT.
-- 2. Cada usuario cotiza solo con las empresas (RUC) que se le asignen.
-- 3. Artículos nuevos: los creados en los últimos 15 días que nadie marcó como revisados.
-- =====================================================================

-- 1. TIPO DE CAMBIO FIJO POR EMPRESA ------------------------------------
alter table public.empresas add column if not exists tipo_cambio numeric(8,4) not null default 3.40;
alter table public.empresas drop constraint if exists empresas_tipo_cambio_check;
alter table public.empresas add constraint empresas_tipo_cambio_check check (tipo_cambio between 1 and 10);
comment on column public.empresas.tipo_cambio is 'Tipo de cambio estándar (S/ por US$) para cotizar en dólares';

-- La cotización siempre usa el T.C. de su empresa: al crearla y si alguien intenta cambiarlo
create or replace function public.cot_tc_y_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tc numeric;
begin
  select tipo_cambio into v_tc from public.empresas where id = new.empresa_id;
  if tg_op = 'INSERT' then
    -- 2. Solo se cotiza con una empresa asignada al usuario (el Administrador, con todas)
    if auth.uid() is not null and not public.puede_cotizar_empresa(new.empresa_id) then
      raise exception 'No tienes permiso para cotizar con esta empresa';
    end if;
    new.tipo_cambio := v_tc;
  elsif new.tipo_cambio is distinct from old.tipo_cambio then
    new.tipo_cambio := v_tc;
  end if;
  return new;
end $$;

-- El límite de venta en dólares se compara con el T.C. de la empresa
create or replace function public.total_para_limite(c public.cotizaciones)
returns numeric language sql stable set search_path = public as $$
  select case when c.moneda = 'USD'
    then c.total * greatest(coalesce((select e.tipo_cambio from public.empresas e where e.id = c.empresa_id), c.tipo_cambio, 1), 1)
    else c.total end;
$$;

-- El permiso "Tipo de cambio" ya no existe
alter table public.roles drop constraint if exists roles_permisos_check;
create or replace function public.permisos_validos()
returns text[] language sql immutable as $$
  select array['cotizaciones_todas', 'aprobar', 'clientes', 'articulos', 'importar',
               'formas_pago', 'empresas', 'reportes', 'actividad', 'revistas']::text[];
$$;
update public.roles set permisos = array_remove(permisos, 'tipos_cambio') where 'tipos_cambio' = any(permisos) or sistema;
alter table public.roles add constraint roles_permisos_check check (permisos <@ public.permisos_validos());

-- 2. EMPRESAS POR USUARIO -------------------------------------------------
do $$
declare v_nueva boolean := not exists (
  select 1 from information_schema.tables where table_schema = 'public' and table_name = 'perfil_empresas');
begin
  create table if not exists public.perfil_empresas (
    perfil_id  uuid not null references public.perfiles(id) on delete cascade,
    empresa_id uuid not null references public.empresas(id) on delete cascade,
    primary key (perfil_id, empresa_id)
  );
  -- Primera vez: todos los usuarios que ya existen quedan con todas las empresas (nadie se queda bloqueado)
  if v_nueva then
    insert into public.perfil_empresas (perfil_id, empresa_id)
    select p.id, e.id from public.perfiles p cross join public.empresas e
    on conflict do nothing;
  end if;
end $$;
comment on table public.perfil_empresas is 'Empresas (RUC) con las que cada usuario puede cotizar';

alter table public.perfil_empresas enable row level security;
drop policy if exists "ver las propias" on public.perfil_empresas;
create policy "ver las propias" on public.perfil_empresas for select to authenticated
  using (perfil_id = (select auth.uid()) or (select public.es_admin()));
drop policy if exists "admin asigna" on public.perfil_empresas;
create policy "admin asigna" on public.perfil_empresas for all to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));
grant select, insert, update, delete on public.perfil_empresas to authenticated;

create or replace function public.puede_cotizar_empresa(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_admin()
      or exists (select 1 from public.perfil_empresas where perfil_id = auth.uid() and empresa_id = p_empresa);
$$;
grant execute on function public.puede_cotizar_empresa(uuid) to authenticated;

drop trigger if exists b_cot_tc_y_empresa on public.cotizaciones;
create trigger b_cot_tc_y_empresa before insert or update on public.cotizaciones
  for each row execute function public.cot_tc_y_empresa();

-- 3. ARTÍCULOS NUEVOS -----------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'articulos' and column_name = 'revisado_at') then
    alter table public.articulos add column revisado_at timestamptz;
    -- Lo que ya está cargado hoy no se marca como nuevo: solo lo que llegue desde ahora
    update public.articulos set revisado_at = now();
  end if;
end $$;
comment on column public.articulos.revisado_at is 'Cuándo alguien lo marcó "Ya lo revisé"; nuevo = creado hace menos de 15 días y sin revisar';
create index if not exists articulos_nuevos_idx on public.articulos (created_at desc) where revisado_at is null;

notify pgrst, 'reload schema';
