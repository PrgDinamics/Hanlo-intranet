import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Mantiene activo el proyecto de Supabase (el plan gratis se pausa tras 7 días sin uso).
 * Lo llama una vez al día GitHub Actions (.github/workflows/keepalive.yml). También sirve desde un cron de cPanel:
 *   curl -s -H "Authorization: Bearer $CRON_SECRET" https://intranet.hanloinnova.com/api/keepalive
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || request.headers.get("authorization") !== `Bearer ${secreto}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    const supabase = createAdminClient();
    // keepalive() es una consulta real a la base y además borra el registro de actividad de más de 45 días
    const { data, error } = await supabase.rpc("keepalive");
    if (error) throw error;
    // Una lectura a Storage también cuenta como actividad
    await supabase.storage.from("media").list("", { limit: 1 });
    const empresas = (data as { empresas?: number } | null)?.empresas ?? null;
    return Response.json({ ok: true, empresas, en: new Date().toISOString() });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
