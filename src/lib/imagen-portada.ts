/**
 * Prepara una imagen de la portada en el navegador (solo navegador): hasta 800 px de lado,
 * sobre fondo blanco (cada imagen va en una tarjeta blanca) y en JPG de hasta 1 MB.
 */
import { LADO_IMAGEN } from "@/lib/portada-web";

const TIPOS = ["image/jpeg", "image/png", "image/webp"];

export async function prepararImagenPortada(archivo: File): Promise<{ ok: true; jpg: Blob; url: string } | { ok: false; error: string }> {
  if (!TIPOS.includes(archivo.type)) return { ok: false, error: "La imagen debe ser JPG, PNG o WebP" };
  if (archivo.size > 10 * 1024 * 1024) return { ok: false, error: "La imagen pesa más de 10 MB" };
  const src = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("No se pudo leer la imagen"));
      i.src = src;
    });
    const f = Math.min(1, LADO_IMAGEN / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * f));
    c.height = Math.max(1, Math.round(img.naturalHeight * f));
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.86, 0.75, 0.6]) {
      const jpg = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", q));
      if (jpg && jpg.size <= 1024 * 1024) return { ok: true, jpg, url: URL.createObjectURL(jpg) };
    }
    return { ok: false, error: "La imagen quedó muy pesada. Prueba con otra" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    URL.revokeObjectURL(src);
  }
}
