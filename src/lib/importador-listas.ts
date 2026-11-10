import "server-only";
import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { claveEnc, numero, texto, type Foto } from "@/lib/importador";
import { todasLasFilas } from "@/lib/consultas";

/**
 * Listas de stock de proveedores (ej. "STOCK CLIENTES ..." y "StockActualizado ... adminplus").
 * Cada hoja es una línea de productos. Encabezados típicos:
 *   CODIGO | IMAGEN | PRODUCTO | COLOR | STOCK FINAL | PRECIO x MILLAR | PRECIO x CIENTO | PRECIO MUESTRA | DESCRIPCION
 * Un producto ocupa varias filas: la primera trae código, nombre y precios; las siguientes solo color y stock.
 */

export type ProductoLista = {
  hoja: string;
  fila: number;
  codigo: string;
  codigoProveedor: string;
  descripcion: string;
  empaque: string | null;
  detalle: string | null;
  linea: string;
  muestra: number | null;
  ciento: number | null;
  millar: number | null;
  desdeCiento: number;
  desdeMillar: number;
  colores: Map<string, number>;
};

export type AvisoLista = { hoja: string; fila: number; mensaje: string };

export type LecturaLista = {
  productos: ProductoLista[];
  hojas: { nombre: string; linea: string; productos: number; colores: number; fotos: number }[];
  ignoradas: string[];
  avisos: AvisoLista[];
  fotos: Map<string, Foto>;
  /** Lo que dice el propio archivo sobre el IGV de sus precios (null = no lo dice o es ambiguo) */
  igv: "incluido" | "sin" | null;
};

/** "LOS PRECIOS NO INCLUYEN IGV" → sin · "S/ 4.84 INCLUIDO IGV" → incluido */
export function igvDeTexto(t: string): "incluido" | "sin" | null {
  const k = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\bno\s+inclu\w*\s+(el\s+)?igv|\bsin\s+igv|\bmas\s+igv|\+\s*igv/.test(k)) return "sin";
  if (/\binclu\w*\s+(el\s+)?igv|\binc\.?\s+igv|\bcon\s+igv/.test(k)) return "incluido";
  return null;
}

/** En celdas combinadas ExcelJS repite el valor en todas; solo cuenta la celda principal */
function propio(cell: ExcelJS.Cell) {
  return cell.isMerged && cell.master && cell.master.address !== cell.address ? "" : texto(cell);
}

const limpiar = (s: string) => s.replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();

/** "1LAPICEROS PLASTICOS" → "LAPICEROS PLASTICOS" */
export function lineaDeHoja(nombre: string) {
  return limpiar(nombre.replace(/^\d+\s*/, "")).toUpperCase().slice(0, 80);
}

/** "2086-R\n(RP-2351)" → "2086-R"; "HL- 1003" → "HL-1003" */
export function normalizarCodigo(raw: string) {
  const primera = limpiar(raw.split(/\r?\n/)[0] ?? "");
  return primera.replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").toUpperCase().slice(0, 30);
}

/** Separa el nombre del empaque: "LAPICERO LASER\n4 FUNCIONES\n200 UNID X CAJA" */
function separarProducto(raw: string) {
  const lineas = raw.split(/\r?\n/).map(limpiar).filter(Boolean);
  const esEmpaque = (l: string) => /\b(unid|unds?|unidades|pzs?|piezas)\b.*\bx\b|\bx\s*caja\b/i.test(l);
  const empaque = lineas.filter(esEmpaque);
  let nombre = lineas.filter((l) => !esEmpaque(l)).join(" ");
  // "BOLSO DE CORCHO 100 UNID X CAJA" en una sola línea
  const cola = /\s+(\d[\d.,]*\s*(?:unid|unds?|unidades|pzs?|piezas)\.?\s*x\s*caja)\s*$/i.exec(nombre);
  if (cola) {
    empaque.push(cola[1].toUpperCase());
    nombre = nombre.slice(0, cola.index);
  }
  return { descripcion: (nombre || lineas.join(" ")).trim().slice(0, 200), empaque: empaque.join(" · ") || null };
}

function desdeEncabezado(enc: string, porDefecto: number) {
  const m = /a partir de\s*(\d+)/i.exec(enc) ?? /(\d+)\s*(pzs|unds|unid)/i.exec(enc);
  return m ? Number(m[1]) : porDefecto;
}

type Columnas = Partial<Record<"codigo" | "imagen" | "producto" | "color" | "stock" | "millar" | "ciento" | "muestra" | "descripcion", number>>;

function detectarEncabezado(ws: ExcelJS.Worksheet) {
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const cols: Columnas = {};
    const textos: Record<string, string> = {};
    ws.getRow(r).eachCell((c, col) => {
      const raw = texto(c);
      const k = claveEnc(raw);
      if (!k) return;
      if (k.startsWith("codigo")) cols.codigo ??= col;
      else if (k.startsWith("imagen")) cols.imagen ??= col;
      else if (k.startsWith("producto")) cols.producto ??= col;
      else if (k.startsWith("color")) cols.color ??= col;
      else if (k.includes("stock")) cols.stock ??= col;
      else if (k.includes("millar")) { cols.millar ??= col; textos.millar = raw; }
      else if (k.includes("ciento")) { cols.ciento ??= col; textos.ciento = raw; }
      else if (k.includes("muestra")) cols.muestra ??= col;
      else if (k.startsWith("descripcion")) cols.descripcion ??= col;
    });
    if (cols.codigo && cols.producto) {
      return {
        fila: r,
        cols,
        desdeCiento: desdeEncabezado(textos.ciento ?? "", 50),
        desdeMillar: desdeEncabezado(textos.millar ?? "", 500),
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Formato "Tienda Publicitaria" (STOCK_DIST_TIENDA_PUBLICITARIA):
//   PRODUCTO (foto) | DESCRIPCION x PRODUCTO | DETALLE x CAJA | COLOR | STOCK | PU 500 A 1000 | PU 50 A 499 | 1 A 49 | PROMOCIONES
// No trae códigos: el producto empieza en la fila con nombre y precios ("S/ 4.84 INCLUIDO IGV");
// las filas siguientes traen especificaciones, empaque y más colores.
// Los precios son UNITARIOS (suelen decir "INCLUIDO IGV"): se guardan como precio x ciento / x millar.
// Si incluyen IGV se decide al importar (opción del proveedor), no aquí.
// ---------------------------------------------------------------------------
type ColsTienda = { foto?: number; nombre: number; caja?: number; color: number; stock: number; millar?: number; ciento?: number; muestra?: number };
type EncTienda = { fila: number; cols: ColsTienda; desdeCiento: number; desdeMillar: number };


function detectarTienda(ws: ExcelJS.Worksheet): EncTienda | null {
  for (let r = 1; r <= Math.min(12, ws.rowCount); r++) {
    const c: Partial<ColsTienda> = {};
    let desdeCiento = 50, desdeMillar = 500;
    ws.getRow(r).eachCell((cell, col) => {
      const k = claveEnc(texto(cell));
      if (!k) return;
      const nums = (k.match(/\d+/g) ?? []).map(Number);
      if (k.startsWith("descripcion")) c.nombre ??= col;
      else if (k.startsWith("producto")) c.foto ??= col;
      else if (k.startsWith("detalle")) c.caja ??= col;
      else if (k.startsWith("color")) c.color ??= col;
      else if (k.includes("stock")) c.stock ??= col;
      else if (nums.length >= 2 && /\ba\b/.test(k)) {
        // "PU 500 A 1000" / "PU 50 A 499" / "1 A 49": el tramo se reconoce por su mínimo
        const min = nums[0];
        if (min >= 200) { c.millar ??= col; desdeMillar = min; }
        else if (min > 1) { c.ciento ??= col; desdeCiento = min; }
        else c.muestra ??= col;
      }
    });
    if (c.nombre && c.color && c.stock && (c.millar || c.ciento || c.muestra)) {
      return { fila: r, cols: c as ColsTienda, desdeCiento, desdeMillar };
    }
  }
  return null;
}

/** "S/ 4.84 INCLUIDO IGV", "   PU: S/ 59.00 INCLUIDO IGV", "S/5.90" → 4.84 */
export function precioSoles(raw: string): number | null {
  const s = raw.replace(/\s+/g, " ");
  const m = /S\/\.?\s*(\d[\d,]*(?:\.\d+)?)/i.exec(s) ?? /(\d[\d,]*(?:\.\d+)?)/.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Código estable a partir del nombre (la lista no trae códigos): "TP-" + hash corto */
export function codigoDeNombre(nombre: string) {
  const k = claveEnc(nombre).toUpperCase();
  let h1 = 0x811c9dc5, h2 = 0x1b873593;
  for (let i = 0; i < k.length; i++) {
    const c = k.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return "TP-" + ((h1 ^ (h2 >>> 7)) >>> 0).toString(36).toUpperCase().padStart(7, "0").slice(-7);
}

const r4 = (n: number | null) => (n === null ? null : Math.round(n * 10000) / 10000);

function leerHojaTienda(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  enc: EncTienda,
  porCodigo: Map<string, ProductoLista>,
  avisos: AvisoLista[],
  fotos: Map<string, Foto>,
): LecturaLista["hojas"][number] {
  const { cols } = enc;
  const linea = lineaDeHoja(ws.name);
  const t = (row: ExcelJS.Row, c?: number) => (c ? limpiar(propio(row.getCell(c))) : "");

  // Bloques de la columna de foto (celdas combinadas) e imágenes ancladas en ella
  const bloqueA = new Map<number, number>(); // fila → fila inicial de su bloque combinado
  const iniciosA = new Set<number>();
  const imagenes = ws.getImages().map((img) => {
    const tl = img.range.tl as unknown as { nativeRow?: number; row?: number; nativeCol?: number; col?: number };
    return { img, fila: Math.floor(tl.nativeRow ?? tl.row ?? -1) + 1, col: Math.floor(tl.nativeCol ?? tl.col ?? -1) + 1 };
  }).filter((i) => cols.foto && i.col === cols.foto);
  if (cols.foto) {
    for (let r = enc.fila + 1; r <= ws.rowCount; r++) {
      const cell = ws.getRow(r).getCell(cols.foto);
      if (cell.isMerged && cell.master) {
        const ini = Number(cell.master.row);
        bloqueA.set(r, ini);
        iniciosA.add(ini);
      }
    }
  }

  type Armado = ProductoLista;
  const lineas = new Map<ProductoLista, { b: string[]; c: string[] }>();
  const de = (p: ProductoLista) => lineas.get(p) ?? (lineas.set(p, { b: [], c: [] }).get(p)!);
  const bloques: { desde: number; codigo: string }[] = [];
  let actual: Armado | null = null;
  let inicioActual = 0;
  let nProd = 0, nCol = 0;
  const propios: Armado[] = [];

  for (let r = enc.fila + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const b = t(row, cols.nombre);
    const c = t(row, cols.caja);
    const color = t(row, cols.color).toUpperCase();
    const stockTxt = t(row, cols.stock);
    const pM = precioSoles(t(row, cols.muestra)), pC = precioSoles(t(row, cols.ciento)), pK = precioSoles(t(row, cols.millar));
    const conPrecio = !!(pM || pC || pK);

    const mismoBloqueA = actual && bloqueA.has(r) && bloqueA.get(r) === bloqueA.get(inicioActual) && bloqueA.get(r) !== r;
    // La foto suele anclarse una fila más abajo del nombre: no sirve para marcar el inicio
    const empieza = !!b && !mismoBloqueA && (conPrecio || iniciosA.has(r));

    if (empieza) {
      const nombre = b.toUpperCase().slice(0, 200);
      const codigo = codigoDeNombre(nombre);
      const existente = porCodigo.get(codigo) as Armado | undefined;
      if (existente && existente.hoja !== ws.name) {
        // El mismo producto listado en otra categoría: es el mismo stock, se toma una sola vez
        avisos.push({ hoja: ws.name, fila: r, mensaje: `${nombre} también figura en ${existente.hoja} (fila ${existente.fila}); se carga una sola vez` });
        actual = null;
        inicioActual = r;
        continue;
      }
      if (existente) {
        avisos.push({ hoja: ws.name, fila: r, mensaje: `${nombre} repetido (también en ${existente.hoja} fila ${existente.fila}); se suman sus colores` });
        actual = existente;
      } else {
        actual = {
          hoja: ws.name, fila: r, codigo, codigoProveedor: nombre, descripcion: nombre, empaque: null, detalle: null, linea,
          muestra: null, ciento: null, millar: null, desdeCiento: enc.desdeCiento, desdeMillar: enc.desdeMillar,
          colores: new Map(),
        };
        porCodigo.set(codigo, actual);
        propios.push(actual);
        nProd++;
      }
      inicioActual = r;
      bloques.push({ desde: r, codigo });
    } else if (actual) {
      if (b) de(actual).b.push(b);
    }
    if (!actual) continue;
    if (c) de(actual).c.push(c);

    // Si un bloque trae dos precios para el mismo tramo, vale el más alto
    const mayor = (a: number | null, n: number | null) => (n === null ? a : a === null ? n : Math.max(a, n));
    const uM = r4(pM), uC = r4(pC), uK = r4(pK);
    actual.muestra = mayor(actual.muestra, uM);
    actual.ciento = mayor(actual.ciento, uC === null ? null : Math.round(uC * 100 * 100) / 100);
    actual.millar = mayor(actual.millar, uK === null ? null : Math.round(uK * 1000 * 100) / 100);

    if (color || stockTxt) {
      const n = numero(stockTxt);
      const stock = n === null || Number.isNaN(n) ? 0 : n;
      if (n === null && stockTxt) avisos.push({ hoja: ws.name, fila: r, mensaje: `${actual.descripcion} · ${color || "ÚNICO"}: stock "${stockTxt}" se carga como 0` });
      const clave = (color || "ÚNICO").slice(0, 40);
      actual.colores.set(clave, (actual.colores.get(clave) ?? 0) + stock);
      nCol++;
    }
  }

  for (const p of propios) {
    const { b: lineasB, c: lineasC } = de(p);
    const emp = lineasC.find((l) => /\b(caja|bolsa)\b.*\d/i.test(l));
    p.empaque = emp ? emp.toUpperCase().slice(0, 120) : null;
    const partes = [lineasB.join("\n"), lineasC.length ? "Presentación:\n" + lineasC.join("\n") : ""].filter(Boolean);
    p.detalle = partes.join("\n\n") || null;
    // Un solo precio (celda combinada sobre los tres tramos, ej. "PU: S/ 59.00"): vale para cualquier cantidad
    const tramos = [p.muestra, p.ciento === null ? null : p.ciento / 100, p.millar === null ? null : p.millar / 1000].filter((x): x is number => x !== null);
    if (tramos.length === 1) {
      const u = Math.round(tramos[0] * 10000) / 10000;
      p.muestra = u;
      p.ciento = Math.round(u * 100 * 100) / 100;
      p.millar = Math.round(u * 1000 * 100) / 100;
    }
    if (!p.muestra && !p.ciento && !p.millar) avisos.push({ hoja: p.hoja, fila: p.fila, mensaje: `${p.descripcion}: sin precios; se carga solo el stock` });
  }

  let nFotos = 0;
  for (const { img, fila } of imagenes) {
    let codigo: string | null = null;
    for (const bl of bloques) if (bl.desde <= fila) codigo = bl.codigo;
    if (!codigo || fotos.has(codigo)) continue;
    const media = wb.getImage(Number(img.imageId));
    if (!media?.buffer) continue;
    fotos.set(codigo, { buffer: Buffer.from(media.buffer as unknown as ArrayBuffer), ext: (media.extension || "png").toLowerCase() });
    nFotos++;
  }

  return { nombre: ws.name, linea, productos: nProd, colores: nCol, fotos: nFotos };
}

// ---------------------------------------------------------------------------
// Formato "Promos" (Stock-Actualizado-Promos):
//   LINEA | CÓDIGO ("CP-66 ESPEJO PORTATIL NAIM") | ARTÍCULO | CÓDIGO SISTEMA | IMAGEN | COLOR | STOCK |
//   A PARTIR DE 500 UND | A PARTIR DE 50 UNID | DE 1 A 49 UNID | DESCRIPCIÓN | PRESENTACIÓN | OBSERVACIONES
// Precios UNITARIOS por tramo. Un producto empieza donde hay CÓDIGO; las filas siguientes son más colores.
// ---------------------------------------------------------------------------
type ColsPromos = {
  codigo: number; articulo?: number; imagen?: number; color?: number; stock: number;
  millar?: number; ciento?: number; muestra?: number; descripcion?: number; presentacion?: number;
};
type EncPromos = { fila: number; cols: ColsPromos; desdeCiento: number; desdeMillar: number };

function detectarPromos(ws: ExcelJS.Worksheet): EncPromos | null {
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const c: Partial<ColsPromos> = {};
    let desdeCiento = 50, desdeMillar = 500;
    ws.getRow(r).eachCell((cell, col) => {
      const k = claveEnc(texto(cell));
      if (!k) return;
      const nums = (k.match(/\d+/g) ?? []).map(Number);
      if (k === "codigo") c.codigo ??= col;
      else if (k.startsWith("articulo")) c.articulo ??= col;
      else if (k.startsWith("imagen")) c.imagen ??= col;
      else if (k.startsWith("color")) c.color ??= col;
      else if (k.includes("stock")) c.stock ??= col;
      else if (k.startsWith("descripcion")) c.descripcion ??= col;
      else if (k.startsWith("presentacion")) c.presentacion ??= col;
      else if (/a partir de|de \d+ a \d+/.test(k) && nums.length) {
        const min = nums[0];
        if (min >= 200) { c.millar ??= col; desdeMillar = min; }
        else if (min > 1) { c.ciento ??= col; desdeCiento = min; }
        else c.muestra ??= col;
      }
    });
    // Hojas principales: CÓDIGO + ARTÍCULO + COLOR. "REMATES" y "Ofertas": solo ARTÍCULO (con el código adelante)
    if ((c.codigo || c.articulo) && c.stock && (c.millar || c.ciento || c.muestra) && (c.codigo ? c.articulo : true)) {
      if (!c.codigo) c.codigo = c.articulo;
      return { fila: r, cols: c as ColsPromos, desdeCiento, desdeMillar };
    }
  }
  return null;
}

/** "CP-66 ESPEJO PORTATIL NAIM" → { codigo: "CP-66", nombre: "ESPEJO PORTATIL NAIM" } */
function partirCodigo(raw: string) {
  const m = /^([A-Z]{1,6}\s*-?\s*\d+[A-Z0-9]*)\s+(.+)$/i.exec(raw.trim());
  if (!m) return { codigo: normalizarCodigo(raw), nombre: raw.trim() };
  return { codigo: normalizarCodigo(m[1]), nombre: m[2].trim() };
}

function leerHojaPromos(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  enc: EncPromos,
  porCodigo: Map<string, ProductoLista>,
  avisos: AvisoLista[],
  fotos: Map<string, Foto>,
): LecturaLista["hojas"][number] {
  const { cols } = enc;
  const linea = lineaDeHoja(ws.name);
  const t = (row: ExcelJS.Row, c?: number) => (c ? limpiar(propio(row.getCell(c))) : "");
  const precio = (row: ExcelJS.Row, c?: number) => {
    const n = c ? precioSoles(t(row, c)) : null;
    return n === null ? null : Math.round(n * 10000) / 10000;
  };
  const bloques: { desde: number; codigo: string }[] = [];
  let actual: ProductoLista | null = null;
  let nProd = 0, nCol = 0;

  for (let r = enc.fila + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawCod = t(row, cols.codigo);
    const color = t(row, cols.color).toUpperCase();
    const stockTxt = t(row, cols.stock);

    if (rawCod) {
      const { codigo: base, nombre } = partirCodigo(rawCod);
      // Mismo código base con otro nombre ("CP-65 TRAVEL KIT SPRAY" y "... SPRAY B"): se distingue
      let codigo = base;
      const previo = porCodigo.get(codigo);
      if (previo && previo.descripcion !== nombre.toUpperCase().slice(0, 200)) {
        codigo = `${base}-${codigoDeNombre(nombre).slice(-4)}`.slice(0, 30);
      }
      const existente = porCodigo.get(codigo);
      if (existente && existente.hoja !== ws.name) {
        avisos.push({ hoja: ws.name, fila: r, mensaje: `${codigo} también figura en ${existente.hoja} (fila ${existente.fila}); se carga una sola vez` });
        actual = null;
        continue;
      }
      const muestra = precio(row, cols.muestra), ciento = precio(row, cols.ciento), millar = precio(row, cols.millar);
      if (existente) {
        actual = existente;
      } else {
        const unicos = [muestra, ciento, millar].filter((x): x is number => x !== null);
        const solo = unicos.length === 1 ? unicos[0] : null; // un solo precio vale para todos los tramos
        actual = {
          hoja: ws.name, fila: r, codigo, codigoProveedor: rawCod.slice(0, 60),
          descripcion: nombre.toUpperCase().slice(0, 200),
          empaque: t(row, cols.presentacion).toUpperCase().slice(0, 120) || null,
          detalle: (cols.descripcion ? texto(row.getCell(cols.descripcion)).trim() : "") || null,
          linea,
          muestra: solo ?? muestra,
          ciento: (solo ?? ciento) === null ? null : Math.round((solo ?? ciento)! * 100 * 100) / 100,
          millar: (solo ?? millar) === null ? null : Math.round((solo ?? millar)! * 1000 * 100) / 100,
          desdeCiento: enc.desdeCiento, desdeMillar: enc.desdeMillar,
          colores: new Map(),
        };
        if (!unicos.length) avisos.push({ hoja: ws.name, fila: r, mensaje: `${codigo}: sin precios; se carga solo el stock` });
        porCodigo.set(codigo, actual);
        nProd++;
      }
      bloques.push({ desde: r, codigo });
    }
    if (!actual) continue;
    if (color || stockTxt) {
      const n = numero(stockTxt);
      const clave = (color || "ÚNICO").slice(0, 40);
      actual.colores.set(clave, (actual.colores.get(clave) ?? 0) + (n === null || Number.isNaN(n) ? 0 : n));
      nCol++;
    }
  }

  let nFotos = 0;
  for (const img of ws.getImages()) {
    const tl = img.range.tl as unknown as { nativeRow?: number; row?: number; nativeCol?: number; col?: number };
    const fila = Math.floor(tl.nativeRow ?? tl.row ?? -1) + 1;
    const col = Math.floor(tl.nativeCol ?? tl.col ?? -1) + 1;
    if (cols.imagen && Math.abs(col - cols.imagen) > 1) continue;
    let codigo: string | null = null;
    for (const b of bloques) if (b.desde <= fila) codigo = b.codigo;
    if (!codigo || fotos.has(codigo)) continue;
    const media = wb.getImage(Number(img.imageId));
    if (!media?.buffer) continue;
    fotos.set(codigo, { buffer: Buffer.from(media.buffer as unknown as ArrayBuffer), ext: (media.extension || "png").toLowerCase() });
    nFotos++;
  }
  return { nombre: ws.name, linea, productos: nProd, colores: nCol, fotos: nFotos };
}

export async function leerListaProveedor(buffer: ArrayBuffer): Promise<LecturaLista> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const porCodigo = new Map<string, ProductoLista>();
  const hojas: LecturaLista["hojas"] = [];
  const ignoradas: string[] = [];
  const avisos: AvisoLista[] = [];
  const fotos = new Map<string, Foto>();

  const votos = { incluido: 0, sin: 0 };
  for (const ws of wb.worksheets) {
    // Avisos de IGV en las primeras filas (títulos, encabezados y primeros precios)
    for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
      ws.getRow(r).eachCell((c) => {
        const v = igvDeTexto(texto(c));
        if (v) votos[v]++;
      });
    }
    const enc = detectarEncabezado(ws);
    if (!enc) {
      const promos = detectarPromos(ws);
      if (promos) {
        hojas.push(leerHojaPromos(wb, ws, promos, porCodigo, avisos, fotos));
        continue;
      }
      const tienda = detectarTienda(ws);
      if (tienda) hojas.push(leerHojaTienda(wb, ws, tienda, porCodigo, avisos, fotos));
      else ignoradas.push(ws.name);
      continue;
    }
    const { cols } = enc;
    const linea = lineaDeHoja(ws.name);
    const t = (row: ExcelJS.Row, c?: number) => (c ? limpiar(texto(row.getCell(c))) : "");
    const bloques: { desde: number; codigo: string }[] = [];
    let actual: ProductoLista | null = null;
    let nProd = 0;
    let nCol = 0;

    for (let r = enc.fila + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const rawCodigo = cols.codigo ? propio(row.getCell(cols.codigo)) : "";
      const color = (cols.color ? limpiar(propio(row.getCell(cols.color))) : "").toUpperCase();
      const stockTxt = cols.stock ? limpiar(propio(row.getCell(cols.stock))) : "";

      if (rawCodigo.trim()) {
        const codigo = normalizarCodigo(rawCodigo);
        const rawProd = cols.producto ? texto(row.getCell(cols.producto)) : "";
        if (!rawProd.trim()) {
          avisos.push({ hoja: ws.name, fila: r, mensaje: `Código ${codigo} sin nombre de producto; se omitió` });
          actual = null;
          continue;
        }
        const { descripcion, empaque } = separarProducto(rawProd);
        const precio = (c?: number) => {
          const n = numero(t(row, c));
          return n === null || Number.isNaN(n) || n <= 0 ? null : n;
        };
        const muestra = precio(cols.muestra), ciento = precio(cols.ciento), millar = precio(cols.millar);
        if (!muestra && !ciento && !millar) {
          avisos.push({ hoja: ws.name, fila: r, mensaje: `${codigo}: sin precios; se carga solo el stock` });
        }
        const existente = porCodigo.get(codigo);
        if (existente) {
          avisos.push({ hoja: ws.name, fila: r, mensaje: `${codigo} repetido (también en ${existente.hoja} fila ${existente.fila}); se suman sus colores` });
          actual = existente;
        } else {
          actual = {
            hoja: ws.name,
            fila: r,
            codigo,
            codigoProveedor: limpiar(rawCodigo.replace(/\r?\n/g, " ")),
            descripcion,
            empaque,
            detalle: cols.descripcion ? texto(row.getCell(cols.descripcion)).replace(/ /g, " ").trim() || null : null,
            linea,
            muestra,
            ciento,
            millar,
            desdeCiento: enc.desdeCiento,
            desdeMillar: enc.desdeMillar,
            colores: new Map(),
          };
          porCodigo.set(codigo, actual);
          nProd++;
        }
        bloques.push({ desde: r, codigo });
      }

      if (actual && (color || stockTxt)) {
        const n = numero(stockTxt);
        const stock = n === null || Number.isNaN(n) ? 0 : n;
        const clave = (color || "ÚNICO").slice(0, 40);
        actual.colores.set(clave, (actual.colores.get(clave) ?? 0) + stock);
        nCol++;
      }
    }

    // Imágenes incrustadas: pertenecen al producto cuyo bloque de filas las contiene
    let nFotos = 0;
    for (const img of ws.getImages()) {
      const tl = img.range.tl as unknown as { nativeRow?: number; row?: number; nativeCol?: number; col?: number };
      const fila = Math.floor(tl.nativeRow ?? tl.row ?? -1) + 1;
      const col = Math.floor(tl.nativeCol ?? tl.col ?? -1) + 1;
      if (cols.imagen && Math.abs(col - cols.imagen) > 1) continue;
      let codigo: string | null = null;
      for (const b of bloques) if (b.desde <= fila) codigo = b.codigo;
      if (!codigo && bloques[0]?.desde === fila + 1) codigo = bloques[0].codigo; // ancla apenas arriba del primero
      if (!codigo || fotos.has(codigo)) continue;
      const media = wb.getImage(Number(img.imageId));
      if (!media?.buffer) continue;
      fotos.set(codigo, { buffer: Buffer.from(media.buffer as unknown as ArrayBuffer), ext: (media.extension || "png").toLowerCase() });
      nFotos++;
    }

    hojas.push({ nombre: ws.name, linea, productos: nProd, colores: nCol, fotos: nFotos });
  }

  const igv = votos.sin && !votos.incluido ? "sin" : votos.incluido && !votos.sin ? "incluido" : null;
  return { productos: [...porCodigo.values()], hojas, ignoradas, avisos, fotos, igv };
}

// ---------------------------------------------------------------------------
// Vista previa
// ---------------------------------------------------------------------------
async function enLotes<T, R>(items: T[], tam: number, fn: (lote: T[]) => Promise<R[]>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += tam) out.push(...(await fn(items.slice(i, i + tam))));
  return out;
}

export async function articulosExistentes(supabase: SupabaseClient, codigos: string[]) {
  const filas = await enLotes(codigos, 200, async (lote) => {
    const { data, error } = await supabase.from("articulos").select("id, codigo, linea_id, detalle, empaque, foto_url").in("codigo", lote);
    if (error) throw new Error("Artículos: " + error.message);
    return (data ?? []) as { id: string; codigo: string; linea_id: string | null; detalle: string | null; empaque: string | null; foto_url: string | null }[];
  });
  return new Map(filas.map((a) => [a.codigo.toUpperCase(), a]));
}

// ---------------------------------------------------------------------------
// Importación
// ---------------------------------------------------------------------------
export async function importarLista(
  supabase: SupabaseClient,
  proveedorId: string,
  lectura: LecturaLista,
  opciones: { ceroSiNoEsta: boolean; incluyeIgv: boolean; igvPct?: number },
) {
  const log: string[] = [];
  // Si la lista trae precios con IGV, se guardan sin IGV (el IGV se suma en la cotización)
  const f = opciones.incluyeIgv ? 1 + (opciones.igvPct ?? 18) / 100 : 1;
  const sin = (n: number | null, dec: number) => (n === null ? null : Math.round((n / f) * 10 ** dec) / 10 ** dec);
  const { productos, fotos } = lectura;
  if (!productos.length) return { log: ["El archivo no tiene productos"] };

  // 1. Líneas
  const nombresLinea = [...new Set(productos.map((p) => p.linea))];
  const lineasBD = await todasLasFilas((a, b) => supabase.from("lineas").select("id, nombre").order("id").range(a, b));
  const lineas = new Map(lineasBD.map((l) => [l.nombre.toUpperCase(), l.id as string]));
  const faltan = nombresLinea.filter((n) => !lineas.has(n.toUpperCase()));
  if (faltan.length) {
    const { data, error } = await supabase.from("lineas").insert(faltan.map((nombre) => ({ nombre }))).select("id, nombre");
    if (error) throw new Error("Líneas: " + error.message);
    for (const l of data ?? []) lineas.set(l.nombre.toUpperCase(), l.id);
    log.push(`${faltan.length} línea(s) nuevas`);
  }

  // 2. Artículos: los nuevos se crean; en los existentes solo se completan datos vacíos
  const existentes = await articulosExistentes(supabase, productos.map((p) => p.codigo));
  const nuevos = productos.filter((p) => !existentes.has(p.codigo));
  for (let i = 0; i < nuevos.length; i += 300) {
    const lote = nuevos.slice(i, i + 300).map((p) => ({
      codigo: p.codigo, descripcion: p.descripcion, detalle: p.detalle, empaque: p.empaque,
      unidad: "Unidad", linea_id: lineas.get(p.linea.toUpperCase()) ?? null,
    }));
    const { data, error } = await supabase.from("articulos").insert(lote).select("id, codigo, linea_id, detalle, empaque, foto_url");
    if (error) throw new Error("Artículos: " + error.message);
    for (const a of data ?? []) existentes.set(a.codigo.toUpperCase(), a);
  }
  let completados = 0;
  for (const p of productos) {
    const a = existentes.get(p.codigo);
    if (!a || nuevos.includes(p)) continue;
    const cambios: Record<string, unknown> = {};
    if (!a.linea_id) cambios.linea_id = lineas.get(p.linea.toUpperCase()) ?? null;
    if (!a.detalle && p.detalle) cambios.detalle = p.detalle;
    if (!a.empaque && p.empaque) cambios.empaque = p.empaque;
    if (Object.keys(cambios).length) {
      const { error } = await supabase.from("articulos").update(cambios).eq("id", a.id);
      if (error) throw new Error("Artículos: " + error.message);
      completados++;
    }
  }
  log.push(`${nuevos.length} artículo(s) nuevos`);
  if (completados) log.push(`${completados} artículo(s) existentes completados (línea, detalle o empaque)`);
  log.push(`${productos.length - nuevos.length} artículo(s) ya existían: solo se actualizan precios y stock`);

  // 3. Precios del proveedor
  //    Los productos que la lista trae sin ningún precio van aparte y sin columnas de precio:
  //    el upsert solo actualiza las columnas que se envían, así no se pisan los precios que ya tenía.
  const conPrecio = productos.filter((p) => p.muestra || p.ciento || p.millar);
  const sinPrecio = productos.filter((p) => !(p.muestra || p.ciento || p.millar));
  const filasAP = conPrecio.map((p) => ({
    articulo_id: existentes.get(p.codigo)!.id,
    proveedor_id: proveedorId,
    codigo_proveedor: p.codigoProveedor,
    precio_venta: sin(p.muestra, 4) ?? 0,
    precio_ciento: sin(p.ciento, 2),
    precio_millar: sin(p.millar, 2),
    desde_ciento: p.desdeCiento,
    desde_millar: p.desdeMillar,
    moneda: "PEN",
  }));
  const filasSoloStock = sinPrecio.map((p) => ({
    articulo_id: existentes.get(p.codigo)!.id,
    proveedor_id: proveedorId,
    codigo_proveedor: p.codigoProveedor,
  }));
  const apIds = new Map<string, string>();
  for (const filas of [filasAP, filasSoloStock]) {
    for (let i = 0; i < filas.length; i += 300) {
      const { data, error } = await supabase
        .from("articulo_proveedor")
        .upsert(filas.slice(i, i + 300), { onConflict: "articulo_id,proveedor_id" })
        .select("id, articulo_id");
      if (error) throw new Error("Precios: " + error.message);
      for (const r of data ?? []) apIds.set(r.articulo_id, r.id);
    }
  }
  log.push(`${filasAP.length} precio(s) del proveedor actualizados${opciones.incluyeIgv ? " (venían con IGV: se guardaron sin IGV)" : " (sin IGV)"}`);
  if (filasSoloStock.length) log.push(`${filasSoloStock.length} artículo(s) sin precios en la lista: solo se actualizó el stock (se conservan sus precios)`);

  // 4. Stock por color: se reemplaza por lo que trae la lista
  const ids = [...apIds.values()];
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from("articulo_proveedor_color").delete().in("articulo_proveedor_id", ids.slice(i, i + 200));
    if (error) throw new Error("Colores: " + error.message);
  }
  const filasColor = productos.flatMap((p) => {
    const ap = apIds.get(existentes.get(p.codigo)!.id)!;
    return [...p.colores].map(([color, stock]) => ({ articulo_proveedor_id: ap, color, stock }));
  });
  for (let i = 0; i < filasColor.length; i += 500) {
    const { error } = await supabase.from("articulo_proveedor_color").insert(filasColor.slice(i, i + 500));
    if (error) throw new Error("Colores: " + error.message);
  }
  log.push(`${filasColor.length} color(es) con stock`);

  // 5. Lo que el proveedor ya no lista queda sin stock
  if (opciones.ceroSiNoEsta) {
    // Todos los artículos del proveedor por páginas (la API corta en 1000 filas)
    const previos = await todasLasFilas((a, b) =>
      supabase.from("articulo_proveedor").select("id").eq("proveedor_id", proveedorId).order("id").range(a, b));
    const fuera = previos.map((r) => r.id as string).filter((id) => !ids.includes(id));
    for (let i = 0; i < fuera.length; i += 200) {
      const lote = fuera.slice(i, i + 200);
      const { error: eCol } = await supabase.from("articulo_proveedor_color").delete().in("articulo_proveedor_id", lote);
      if (eCol) throw new Error("Stock en cero: " + eCol.message);
      const { error: eStock } = await supabase.from("articulo_proveedor").update({ stock: 0, stock_al: new Date().toISOString() }).in("id", lote);
      if (eStock) throw new Error("Stock en cero: " + eStock.message);
    }
    if (fuera.length) log.push(`${fuera.length} artículo(s) que ya no figuran en la lista quedaron con stock 0`);
  }

  // 6. Fotos: solo para artículos que aún no tienen
  const pendientes = productos.filter((p) => !existentes.get(p.codigo)?.foto_url && fotos.has(p.codigo));
  let subidas = 0;
  const errores: string[] = [];
  for (let i = 0; i < pendientes.length; i += 6) {
    await Promise.all(
      pendientes.slice(i, i + 6).map(async (p) => {
        const foto = fotos.get(p.codigo)!;
        const ext = ["jpeg", "jpg"].includes(foto.ext) ? "jpg" : foto.ext;
        const path = `articulos/${p.codigo.replace(/[^A-Z0-9_-]/gi, "_")}-${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from("media").upload(path, foto.buffer, {
          contentType: ext === "jpg" ? "image/jpeg" : `image/${ext}`,
          upsert: true,
        });
        if (error) return void errores.push(p.codigo);
        const url = supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
        const { error: eFoto } = await supabase.from("articulos").update({ foto_url: url }).eq("id", existentes.get(p.codigo)!.id);
        if (eFoto) return void errores.push(p.codigo);
        subidas++;
      }),
    );
  }
  if (subidas) log.push(`${subidas} foto(s) nuevas`);
  if (errores.length) log.push(`No se pudieron subir ${errores.length} foto(s): ${errores.slice(0, 5).join(", ")}`);

  return { log };
}
