/**
 * Aligera un .xlsx en el navegador antes de subirlo.
 * Lo que pesa en las listas de los proveedores son las fotos pegadas (fotos de cámara de 3 a 8 MB cada una).
 * Se abren las imágenes de xl/media, se reducen a 1000 px y se guardan como JPEG;
 * se actualizan las referencias (.rels) y los tipos de contenido. Las celdas no se tocan.
 */
import JSZip from "jszip";

const LADO_MAX = 1000;
const CALIDAD = 0.82;
const MIN_BYTES = 180 * 1024; // las imágenes chicas se dejan igual

export type Progreso = (texto: string) => void;

async function comprimir(datos: Uint8Array): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(new Blob([datos as BlobPart]));
    const escala = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * escala));
    const h = Math.max(1, Math.round(bmp.height * escala));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; // los PNG transparentes quedan sobre blanco
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", CALIDAD));
    canvas.width = canvas.height = 0;
    return blob;
  } catch {
    return null; // EMF, WMF u otro formato que el navegador no abre: se deja tal cual
  }
}

export async function aligerarExcel(archivo: File, progreso?: Progreso): Promise<{ blob: Blob; antes: number; despues: number; fotos: number }> {
  progreso?.("Abriendo el Excel...");
  const zip = await JSZip.loadAsync(await archivo.arrayBuffer());
  const medias = Object.keys(zip.files).filter((n) => /^xl\/media\/[^/]+\.(png|jpe?g|gif|bmp|tiff?|webp)$/i.test(n));
  const renombres = new Map<string, string>(); // "image3.png" → "image3.jpeg"
  let hechas = 0;
  let optimizadas = 0;

  for (const ruta of medias) {
    hechas++;
    if (hechas % 10 === 1) progreso?.(`Optimizando fotos ${hechas} de ${medias.length}...`);
    const datos = await zip.file(ruta)!.async("uint8array");
    if (datos.byteLength < MIN_BYTES) continue;
    const jpg = await comprimir(datos);
    if (!jpg || jpg.size >= datos.byteLength) continue;
    const base = ruta.slice("xl/media/".length);
    const nuevo = base.replace(/\.[^.]+$/, "") + ".jpeg";
    // Evita choque si ya existe un imageN.jpeg distinto
    if (nuevo !== base && zip.file("xl/media/" + nuevo)) continue;
    zip.remove(ruta);
    zip.file("xl/media/" + nuevo, jpg);
    if (nuevo !== base) renombres.set(base, nuevo);
    optimizadas++;
  }

  if (renombres.size) {
    progreso?.("Actualizando referencias...");
    const rels = Object.keys(zip.files).filter((n) => n.endsWith(".rels"));
    for (const r of rels) {
      let xml = await zip.file(r)!.async("string");
      let cambio = false;
      xml = xml.replace(/media\/([^"/]+)"/g, (m, nombre: string) => {
        const n = renombres.get(nombre);
        if (!n) return m;
        cambio = true;
        return `media/${n}"`;
      });
      if (cambio) zip.file(r, xml);
    }
    let tipos = await zip.file("[Content_Types].xml")!.async("string");
    if (!/Extension="jpeg"/i.test(tipos)) {
      tipos = tipos.replace("<Default ", '<Default Extension="jpeg" ContentType="image/jpeg"/><Default ');
    }
    // Overrides explícitos de las imágenes renombradas
    for (const [viejo, nuevo] of renombres) {
      tipos = tipos.replace(new RegExp(`(PartName="/xl/media/)${viejo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*/>`, "g"),
        `$1${nuevo}" ContentType="image/jpeg"/>`);
    }
    zip.file("[Content_Types].xml", tipos);
  }

  progreso?.("Empaquetando...");
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  return { blob, antes: archivo.size, despues: blob.size, fotos: optimizadas };
}

export const LIMITE_SUBIDA = 45 * 1024 * 1024;
export const mb = (b: number) => (b / 1024 / 1024).toFixed(1) + " MB";

/**
 * Aligera el Excel si pesa más de 8 MB y lo sube al bucket privado "importaciones".
 * Devuelve la ruta o un error legible.
 */
export async function prepararYSubir(
  f: File,
  progreso: Progreso,
): Promise<{ ok: true; ruta: string; nota: string | null } | { ok: false; error: string }> {
  if (!/\.xlsx$/i.test(f.name)) return { ok: false, error: "El archivo debe ser un Excel .xlsx" };
  let cuerpo: Blob = f;
  let nota: string | null = null;
  if (f.size > 8 * 1024 * 1024) {
    try {
      const r = await aligerarExcel(f, progreso);
      if (r.despues < r.antes) {
        cuerpo = r.blob;
        nota = `Se optimizaron ${r.fotos} foto(s): el archivo pasó de ${mb(r.antes)} a ${mb(r.despues)}`;
      }
    } catch {
      return { ok: false, error: "No se pudo abrir el Excel. ¿Es un .xlsx válido? Ábrelo y vuelve a guardarlo como .xlsx" };
    }
  }
  if (cuerpo.size > LIMITE_SUBIDA) {
    return {
      ok: false,
      error: `Aun optimizando las fotos el archivo pesa ${mb(cuerpo.size)} (máximo ${mb(LIMITE_SUBIDA)}). Divídelo en dos archivos por hojas.`,
    };
  }
  progreso(`Subiendo archivo (${mb(cuerpo.size)})...`);
  const { createClient } = await import("@/lib/supabase/client");
  const ruta = `${crypto.randomUUID()}.xlsx`;
  const { error } = await createClient().storage.from("importaciones").upload(ruta, await cuerpo.arrayBuffer(), {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  if (error) return { ok: false, error: "No se pudo subir el archivo: " + error.message };
  return { ok: true, ruta, nota };
}
