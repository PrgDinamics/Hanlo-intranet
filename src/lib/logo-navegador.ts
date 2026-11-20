/**
 * Prepara un logo en el navegador antes de subirlo (solo navegador):
 * quita el fondo blanco que toca los bordes, recorta lo vacío y lo deja de 120 px de alto en PNG transparente.
 * Un SVG también se convierte a PNG: así no puede llevar código a la web.
 */
import { ALTO_LOGO, MAX_BYTES_ORIGINAL } from "@/lib/clientes-web";

const TIPOS = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export async function prepararLogo(archivo: File): Promise<{ ok: true; png: Blob; url: string } | { ok: false; error: string }> {
  if (!TIPOS.includes(archivo.type)) return { ok: false, error: "El logo debe ser PNG, JPG, WebP o SVG" };
  if (archivo.size > MAX_BYTES_ORIGINAL) return { ok: false, error: "El logo pesa más de 1 MB. Usa una versión más liviana" };
  const src = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("No se pudo leer la imagen"));
      i.src = src;
    });
    // Un SVG sin tamaño propio se dibuja a 800 px de ancho
    let w = img.naturalWidth || 800, h = img.naturalHeight || 400;
    const escala = Math.min(1, 2000 / Math.max(w, h));
    w = Math.max(1, Math.round(w * escala)); h = Math.max(1, Math.round(h * escala));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    const datos = ctx.getImageData(0, 0, w, h);
    const p = datos.data;
    quitarFondoBlanco(p, w, h);
    // Recorte de bordes vacíos
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (p[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return { ok: false, error: "La imagen está vacía o es toda blanca" };
    ctx.putImageData(datos, 0, 0);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    // 120 px de alto; los logos muy anchos se limitan a 720 px de ancho
    const f = Math.min(ALTO_LOGO / ch, 720 / cw);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(cw * f)); out.height = Math.max(1, Math.round(ch * f));
    const o = out.getContext("2d")!;
    o.imageSmoothingQuality = "high";
    o.drawImage(c, x0, y0, cw, ch, 0, 0, out.width, out.height);
    const png = await new Promise<Blob | null>((res) => out.toBlob(res, "image/png"));
    if (!png) return { ok: false, error: "No se pudo convertir el logo" };
    return { ok: true, png, url: URL.createObjectURL(png) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    URL.revokeObjectURL(src);
  }
}

/** Hace transparente el blanco (o casi blanco) conectado con los bordes; el blanco dentro del logo se conserva */
function quitarFondoBlanco(p: Uint8ClampedArray, w: number, h: number) {
  const blanco = (i: number) => p[i * 4 + 3] > 0 && p[i * 4] > 240 && p[i * 4 + 1] > 240 && p[i * 4 + 2] > 240;
  const visto = new Uint8Array(w * h);
  const pila: number[] = [];
  for (let x = 0; x < w; x++) { pila.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { pila.push(y * w, y * w + w - 1); }
  while (pila.length) {
    const i = pila.pop()!;
    if (visto[i] || !blanco(i)) continue;
    visto[i] = 1;
    p[i * 4 + 3] = 0;
    const x = i % w, y = (i - x) / w;
    if (x > 0) pila.push(i - 1);
    if (x < w - 1) pila.push(i + 1);
    if (y > 0) pila.push(i - w);
    if (y < h - 1) pila.push(i + w);
  }
}
