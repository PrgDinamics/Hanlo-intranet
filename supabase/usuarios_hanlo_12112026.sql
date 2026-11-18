-- =====================================================================
-- Usuarios del equipo Hanlo (12/11/2026). Correr en Supabase > SQL Editor.
--   1. El usuario administrador deja de llamarse "Lorena Prado": pasa a "Administrador".
--   2. Crea (o actualiza) las cuentas del equipo con su contraseña, ya confirmadas y activas,
--      con su rol y su agente comercial (para que su nombre salga en la firma de la cotización).
-- Se puede correr más de una vez: si la cuenta ya existe, solo le vuelve a poner la contraseña,
-- el nombre, el rol y el agente.
-- Para cambiar el rol de alguien, cambia 'Vendedor' por 'Administrador', 'Coordinador', etc.
-- (los nombres de Configuración > Roles y permisos).
-- =====================================================================

do $$
declare
  u record;
  v_uid uuid;
  v_agente uuid;
  v_rol uuid;
begin
  -- crypt() y gen_salt() están en el esquema "extensions" en Supabase
  set local search_path = public, extensions, auth;

  -- 1. El admin vuelve a ser "Administrador" y deja de firmar como Lorena
  update public.perfiles set nombre = 'Administrador', agente_id = null
   where rol = 'admin' and nombre ilike 'lorena prado';

  -- 2. Equipo: correo, nombre, contraseña, rol
  for u in
    select * from (values
      ('lorena.prado@hanloinnova.com',    'Lorena Prado',    'Lorena47!',    'Administrador'),
      ('evelyn.sanchez@hanloinnova.com',  'Evelyn Sánchez',  'Evelyn82@',    'Vendedor'),
      ('elizabeth.salas@hanloinnova.com', 'Elizabeth Salas', 'Elizabeth36!', 'Vendedor'),
      ('lguevara@hanloinnova.com',        'L. Guevara',      'Guevara59@',   'Vendedor')
    ) as t(email, nombre, clave, rol)
  loop
    select id into v_rol from public.roles where nombre = u.rol;
    if v_rol is null then
      raise exception 'No existe el rol "%" (revisa Configuración > Roles y permisos)', u.rol;
    end if;

    -- Cuenta de acceso
    select id into v_uid from auth.users where lower(email) = u.email;
    if v_uid is null then
      v_uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values (
        '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', u.email,
        crypt(u.clave, gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('nombre', u.nombre),
        now(), now(), '', '', '', '');
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (v_uid::text, v_uid,
              jsonb_build_object('sub', v_uid::text, 'email', u.email, 'email_verified', true),
              'email', now(), now(), now());
    else
      update auth.users
         set encrypted_password = crypt(u.clave, gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at = now()
       where id = v_uid;
    end if;

    -- Agente comercial (firma de la cotización): se busca por correo o por nombre
    select id into v_agente from public.agentes
     where lower(email) = u.email or lower(nombre) = lower(u.nombre)
     order by (lower(email) = u.email) desc nulls last limit 1;
    if v_agente is null then
      insert into public.agentes (nombre, email, activo) values (u.nombre, u.email, true) returning id into v_agente;
    else
      update public.agentes set nombre = u.nombre, email = u.email, activo = true where id = v_agente;
    end if;

    -- Perfil de la intranet (el trigger de registro lo crea como vendedor inactivo)
    insert into public.perfiles (id, email, nombre, rol_id, agente_id, activo)
    values (v_uid, u.email, u.nombre, v_rol, v_agente, true)
    on conflict (id) do update
      set email = excluded.email, nombre = excluded.nombre, rol_id = excluded.rol_id,
          agente_id = excluded.agente_id, activo = true;
  end loop;
end $$;

-- Revisión: cómo quedaron
select p.nombre, p.email, r.nombre as rol, a.nombre as agente, p.activo
  from public.perfiles p
  left join public.roles r on r.id = p.rol_id
  left join public.agentes a on a.id = p.agente_id
 order by r.sistema desc, p.nombre;
