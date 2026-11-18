import "server-only";
import { after } from "next/server";
import { publicarCatalogo } from "@/lib/catalogo-web";

/**
 * Actualiza la web después de responder (crear, editar o borrar artículos y líneas, "Ya lo revisé").
 * Si el cPanel falla no afecta lo que hizo el usuario: queda en el registro del servidor
 * y lo corrige la siguiente publicación (botón, importación o la tarea diaria).
 */
export function publicarCatalogoDespues() {
  after(async () => {
    const r = await publicarCatalogo();
    if (!r.ok) console.warn(`[catálogo web] ${r.error}`);
  });
}
