// Crea (o repara) el usuario administrador.
// Uso: node --env-file=.env.local scripts/crear-admin.mjs correo@empresa.com "Contraseña123" "Nombre Apellido"
// Si el correo ya existe: le pone esa contraseña, lo deja como admin activo y crea su perfil si falta.
import { createClient } from "@supabase/supabase-js";

async function main() {
  const [emailArg, password, nombre = "Administrador"] = process.argv.slice(2);
  if (!emailArg || !password) {
    console.error('Uso: node --env-file=.env.local scripts/crear-admin.mjs correo "contraseña" "Nombre"');
    return 1;
  }
  const email = emailArg.trim().toLowerCase();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en .env.local");
    return 1;
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let user;
  const creado = await supabase.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { nombre, rol: "admin" },
  });
  if (!creado.error) {
    user = creado.data.user;
  } else if (/already|registered|exists/i.test(creado.error.message)) {
    // Ya existe: se busca y se actualiza
    for (let page = 1; !user; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error) { console.error("Error:", error.message); return 1; }
      user = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
      if (data.users.length < 200) break;
    }
    if (!user) { console.error("El correo figura como registrado pero no se encontró el usuario"); return 1; }
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password, email_confirm: true, user_metadata: { ...user.user_metadata, nombre, rol: "admin" },
    });
    if (error) { console.error("Error:", error.message); return 1; }
    console.log("El usuario ya existía: se actualizó su contraseña");
  } else {
    console.error("Error:", creado.error.message);
    return 1;
  }

  // Perfil de la intranet (se crea si el usuario es anterior a la instalación de las tablas)
  const { error: errPerfil } = await supabase
    .from("perfiles")
    .upsert({ id: user.id, email, nombre, rol: "admin", activo: true }, { onConflict: "id" });
  if (errPerfil) {
    console.error("Usuario listo, pero no se pudo crear su perfil:", errPerfil.message);
    console.error("¿Corriste instalar_todo.sql en Supabase?");
    return 1;
  }
  console.log("Administrador listo:", email);
  return 0;
}

// exitCode en vez de process.exit(): evita el "Assertion failed ... async.c" de Node en Windows
main().then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
