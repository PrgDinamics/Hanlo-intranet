import "server-only";
import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UNIDADES } from "@/lib/modulos";
import { todasLasFilas } from "@/lib/consultas";

/**
 * Importador de la "Plantilla de carga inicial".
 * Lee las hojas por nombre y las columnas por encabezado (se ignora el " *" de obligatorias).
 * La fila 2 es ayuda; la fila 3 trae un ejemplo que se descarta solo si no fue modificado.
 */

type Fila = { fila: number; v: Record<string, string> };
export type ErrorFila = { hoja: string; fila: number; mensaje: string };
export type ResumenHoja = { hoja: string; filas: number; nuevos: number; existentes: number; errores: number };

const EJEMPLO: Record<string, [string, string]> = {
  Empresa: ["RUC", "20600000001"],
  Agentes: ["Nombre", "Carlos Ramírez"],
  Usuarios: ["Correo", "lorena@hanlo.pe"],
  "Formas de pago": ["Nombre", "Crédito 30 días"],
  Líneas: ["Nombre", "Útiles de oficina"],
  Proveedores: ["RUC", "20100000011"],
  Artículos: ["Código", "PAP-A4-75"],
  Precios: ["Código artículo", "PAP-A4-75"],
  Clientes: ["Número de documento", "20500000101"],
};

export const ORDEN_HOJAS = ["Empresa", "Agentes", "Usuarios", "Formas de pago", "Líneas", "Proveedores", "Artículos", "Precios", "Clientes"];

export function texto(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v) return String(v.result ?? "").trim();
  return (cell.text ?? "").toString().trim();
}

export type Foto = { buffer: Buffer; ext: string };
export type Lectura = { hojas: Record<string, Fila[]>; fotos: Map<string, Foto>; formato: "plantilla" | "cliente" };

/** Detecta el formato del archivo y lo convierte a hojas con columnas canónicas */
export async function leerArchivo(buffer: ArrayBuffer): Promise<Lectura> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const art = wb.getWorksheet("Artículos") ?? wb.getWorksheet("Articulos");
  const esCliente =
    !!wb.getWorksheet("AgentesVenta") || (!!art && buscarEncabezado(art, "id articulo") !== null);
  if (esCliente) return leerFormatoCliente(wb);
  return { hojas: leerPlantilla(wb), fotos: new Map(), formato: "plantilla" };
}

function leerPlantilla(wb: ExcelJS.Workbook) {
  const hojas: Record<string, Fila[]> = {};
  for (const nombre of ORDEN_HOJAS) {
    const ws = wb.getWorksheet(nombre);
    if (!ws) continue;
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => {
      headers[i] = texto(c).replace(/\s*\*$/, "").trim();
    });
    const filas: Fila[] = [];
    for (let r = 3; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const v: Record<string, string> = {};
      let vacia = true;
      headers.forEach((h, i) => {
        if (!h) return;
        const t = texto(row.getCell(i));
        if (t) vacia = false;
        v[h] = t;
      });
      if (vacia) continue;
      const ej = EJEMPLO[nombre];
      if (r === 3 && ej && v[ej[0]] === ej[1]) continue; // fila de ejemplo sin tocar
      filas.push({ fila: r, v });
    }
    hojas[nombre] = filas;
  }
  return hojas;
}

// ---------------------------------------------------------------------------
// Formato del cliente ("Información para cargar a la BD"):
//   Artículos: fila 2 agrupa "Proveedor 1..4", fila 3 encabezados, datos desde la 4,
//              imágenes incrustadas en la columna "Imagen", columna STOCK al final.
//   Proveedores / Clientes: encabezados en fila 3 (bloque CONTACTO en la fila 2).
//   AgentesVenta: encabezados en fila 2 (bloque Permisos en la fila 1).
// ---------------------------------------------------------------------------
function buscarEncabezado(ws: ExcelJS.Worksheet, clave: string) {
  for (let r = 1; r <= Math.min(6, ws.rowCount); r++) {
    let hit = false;
    ws.getRow(r).eachCell((c) => { if (claveEnc(texto(c)) === clave) hit = true; });
    if (hit) return r;
  }
  return null;
}

function encabezados(ws: ExcelJS.Worksheet, fila: number) {
  const h: { col: number; nombre: string }[] = [];
  ws.getRow(fila).eachCell((c, col) => { h.push({ col, nombre: claveEnc(texto(c)) }); });
  // columnas con el encabezado en la fila de arriba (ej. STOCK combinada en dos filas)
  if (fila > 1) {
    ws.getRow(fila - 1).eachCell((c, col) => {
      if (!h.some((x) => x.col === col)) h.push({ col, nombre: claveEnc(texto(c)) });
    });
  }
  return h;
}

function leerTabla(ws: ExcelJS.Worksheet | undefined, claveEncabezado: string, mapa: Record<string, string>): Fila[] {
  if (!ws) return [];
  const fh = buscarEncabezado(ws, claveEncabezado);
  if (!fh) return [];
  const cols = encabezados(ws, fh);
  const filas: Fila[] = [];
  for (let r = fh + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const v: Record<string, string> = {};
    let vacia = true;
    for (const { col, nombre } of cols) {
      const destino = mapa[nombre];
      if (!destino) continue;
      const t = texto(row.getCell(col));
      if (t) vacia = false;
      v[destino] = t;
    }
    if (!vacia) filas.push({ fila: r, v });
  }
  return filas;
}

function leerFormatoCliente(wb: ExcelJS.Workbook): Lectura {
  const hojas: Record<string, Fila[]> = {};
  const fotos = new Map<string, Foto>();

  // Artículos + precios por proveedor (pares Ruc / Pr.Unit)
  const ws = wb.getWorksheet("Artículos") ?? wb.getWorksheet("Articulos");
  const fh = ws ? buscarEncabezado(ws, "id articulo") : null;
  if (ws && fh) {
    const cols = encabezados(ws, fh);
    const col = (n: string) => cols.find((c) => c.nombre === n)?.col;
    const pares = cols
      .filter((c) => c.nombre === "ruc")
      .sort((a, b) => a.col - b.col)
      .map((c) => ({ ruc: c.col, precio: cols.find((x) => x.col === c.col + 1 && x.nombre.replace(/\s/g, "").startsWith("prunit"))?.col }))
      .filter((p): p is { ruc: number; precio: number } => !!p.precio);
    const cId = col("id articulo"), cLin = col("linea"), cDesc = col("descripcion"), cDet = col("detalle"),
      cUnd = col("unidad"), cImg = col("imagen"), cStock = col("stock");
    const arts: Fila[] = [];
    const precios: Fila[] = [];
    const filaACodigo = new Map<number, string>();
    for (let r = fh + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const t = (c?: number) => (c ? texto(row.getCell(c)) : "");
      const codigo = t(cId);
      if (!codigo && !t(cDesc)) continue;
      filaACodigo.set(r, codigo.toUpperCase());
      arts.push({
        fila: r,
        v: { "Código": codigo, "Línea": t(cLin), "Descripción": t(cDesc), "Detalle": t(cDet), "Unidad": t(cUnd), "Stock referencial": t(cStock) },
      });
      for (const p of pares) {
        const ruc = t(p.ruc), precio = t(p.precio);
        if (!ruc && !precio) continue;
        precios.push({ fila: r, v: { "Código artículo": codigo, "RUC proveedor": ruc, "Precio venta": precio, "Precio costo": "", "Moneda": "PEN", "Preferido": "" } });
      }
    }
    hojas["Artículos"] = arts;
    hojas["Precios"] = precios;

    // Imágenes incrustadas: se asocian a la fila donde están ancladas
    for (const img of ws.getImages()) {
      const tl = img.range.tl as unknown as { nativeRow?: number; row?: number; nativeCol?: number; col?: number };
      const fila = Math.floor(tl.nativeRow ?? tl.row ?? -1) + 1;
      const colImg = Math.floor(tl.nativeCol ?? tl.col ?? -1) + 1;
      if (cImg && Math.abs(colImg - cImg) > 1) continue;
      const codigo = filaACodigo.get(fila);
      const media = wb.getImage(Number(img.imageId));
      if (!codigo || !media?.buffer || fotos.has(codigo)) continue;
      fotos.set(codigo, { buffer: Buffer.from(media.buffer as unknown as ArrayBuffer), ext: (media.extension || "png").toLowerCase() });
    }
  }

  const tercero: Record<string, string> = {
    "n ruc": "RUC", "no ruc": "RUC", "nro ruc": "RUC", "ruc": "RUC", "nombre o razon social": "Razón social",
    "direccion": "Dirección", "nro doc id": "Doc contacto", "nombres y apellidos": "Persona de contacto",
    "cargo": "Cargo", "nro telefono": "Teléfono", "telefono": "Teléfono", "email": "Correo", "e mail": "Correo", "correo": "Correo",
  };
  hojas["Proveedores"] = leerTabla(wb.getWorksheet("Proveedores"), "nombre o razon social", tercero);
  hojas["Clientes"] = leerTabla(wb.getWorksheet("Clientes"), "nombre o razon social", tercero).map((f) => {
    const doc = soloDigitos(f.v["RUC"] ?? "");
    const tipoDoc = doc.length === 8 ? "DNI" : "RUC";
    return {
      fila: f.fila,
      v: {
        "Tipo de persona": tipoDoc === "DNI" || doc.startsWith("10") ? "Natural" : "Jurídica",
        "Tipo de documento": tipoDoc,
        "Número de documento": f.v["RUC"] ?? "",
        "Nombre o razón social": f.v["Razón social"] ?? "",
        "Dirección": f.v["Dirección"] ?? "",
        "Teléfono": f.v["Teléfono"] ?? "",
        "Correo": f.v["Correo"] ?? "",
        "Persona de contacto": f.v["Persona de contacto"] ?? "",
        "Doc contacto": f.v["Doc contacto"] ?? "",
        "Cargo": f.v["Cargo"] ?? "",
      },
    };
  });
  hojas["Agentes"] = leerTabla(wb.getWorksheet("AgentesVenta"), "nombres y apellidos", {
    "id vendedor": "ID", "nombres y apellidos": "Nombre", "crea cliente": "Crea cliente",
    "crea articulo": "Crea artículo", "limite s venta": "Límite", "limite": "Límite",
  });
  for (const k of Object.keys(hojas)) if (!hojas[k].length) delete hojas[k];
  return { hojas, fotos, formato: "cliente" };
}

// ---------------------------------------------------------------------------
// Normalizadores
// ---------------------------------------------------------------------------
const soloDigitos = (s: string) => s.replace(/\D/g, "");
export const numero = (s: string) => {
  if (!s) return null;
  const n = Number(s.replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
export function sinTildes(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
/** Para comparar encabezados: sin tildes, sin °/º/./- y espacios simples */
export function claveEnc(s: string) {
  return sinTildes(s).replace(/[°º.\-_*/]/g, " ").replace(/\s+/g, " ").trim();
}
const nulo = (s: string) => (s ? s : null);

/**
 * Arma el registro solo con las columnas que trae el archivo, para que una
 * reimportación con otro formato no borre datos que no vienen en él.
 */
function presentes(
  v: Record<string, string>,
  base: Record<string, unknown>,
  campos: Record<string, [string, (x: string) => unknown]>,
) {
  const out: Record<string, unknown> = { ...base };
  for (const [col, [origen, fn]] of Object.entries(campos)) if (origen in v) out[col] = fn(v[origen] ?? "");
  return out;
}

/** "juego" → "Juego"; si coincide con una sugerida usa esa forma */
export function normalizarUnidad(s?: string) {
  const t = (s ?? "").trim();
  if (!t) return "Unidad";
  const hit = UNIDADES.find((u) => sinTildes(u) === sinTildes(t));
  return hit ?? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

type Registro = { fila: number; clave: string; datos: Record<string, unknown>; extra?: Record<string, unknown> };

/** Convierte las filas a registros listos para guardar, acumulando errores */
export function validar(hojas: Record<string, Fila[]>) {
  const errores: ErrorFila[] = [];
  const err = (hoja: string, fila: number, mensaje: string) => errores.push({ hoja, fila, mensaje });
  const out: Record<string, Registro[]> = {};
  const vistos = (hoja: string) => {
    const set = new Set<string>();
    return (fila: number, clave: string, etiqueta: string) => {
      const k = clave.toLowerCase();
      if (set.has(k)) {
        err(hoja, fila, `${etiqueta} "${clave}" está repetido en la hoja`);
        return false;
      }
      set.add(k);
      return true;
    };
  };

  // Empresa
  {
    const H = "Empresa"; const unico = vistos(H); out[H] = [];
    for (const { fila, v } of hojas[H] ?? []) {
      const ruc = soloDigitos(v["RUC"] ?? "");
      if (ruc.length !== 11) { err(H, fila, `RUC debe tener 11 dígitos (tiene ${ruc.length})`); continue; }
      if (!v["Razón social"]) { err(H, fila, "Falta la razón social"); continue; }
      const corr = numero(v["Último número usado"] ?? "");
      if (Number.isNaN(corr)) { err(H, fila, "Último número usado no es un número"); continue; }
      if (!unico(fila, ruc, "RUC")) continue;
      out[H].push({
        fila, clave: ruc,
        datos: {
          ruc, razon_social: v["Razón social"], nombre_comercial: nulo(v["Nombre comercial"]), direccion: nulo(v["Dirección"]),
          telefono: nulo(v["Teléfono"]), email: nulo(v["Correo"]), web: nulo(v["Página web"]),
          serie: (v["Serie de cotización"] || "COT").toUpperCase().slice(0, 10),
          correlativo_inicial: Math.max(0, Math.trunc(corr ?? 0)), pie_cotizacion: nulo(v["Pie de cotización"]),
        },
      });
    }
  }

  // Agentes
  {
    const H = "Agentes"; const unico = vistos(H); out[H] = [];
    for (const { fila, v } of hojas[H] ?? []) {
      if (!v["Nombre"]) { err(H, fila, "Falta el nombre"); continue; }
      if (!unico(fila, v["Nombre"], "Agente")) continue;
      const datos: Record<string, unknown> = {};
      datos.nombre = v["Nombre"];
      if ("Correo" in v) datos.email = nulo(v["Correo"]);
      if ("Teléfono" in v) datos.telefono = nulo(v["Teléfono"]);
      if ("ID" in v) datos.num_doc = nulo(v["ID"].slice(0, 15));
      if ("Crea cliente" in v) datos.crea_cliente = sinTildes(v["Crea cliente"]) === "si";
      if ("Crea artículo" in v) datos.crea_articulo = sinTildes(v["Crea artículo"]) === "si";
      if ("Límite" in v) {
        const lim = numero(v["Límite"]);
        if (Number.isNaN(lim) || (lim ?? 0) < 0) { err(H, fila, "Límite S/ de venta no es un número válido"); continue; }
        datos.limite_venta = lim;
      }
      out[H].push({ fila, clave: v["Nombre"], datos });
    }
  }

  // Usuarios
  {
    const H = "Usuarios"; const unico = vistos(H); out[H] = [];
    for (const { fila, v } of hojas[H] ?? []) {
      const email = (v["Correo"] ?? "").toLowerCase();
      if (!v["Nombre"]) { err(H, fila, "Falta el nombre"); continue; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err(H, fila, "Correo no válido"); continue; }
      // El rol se valida contra la tabla roles en la vista previa (Administrador, Vendedor, Coordinador u otro creado)
      const rol = (v["Rol"] ?? "").trim();
      if (!rol) { err(H, fila, "Falta el rol (Administrador, Vendedor, Coordinador u otro rol creado)"); continue; }
      if (!unico(fila, email, "Correo")) continue;
      out[H].push({
        fila, clave: email,
        datos: { nombre: v["Nombre"], email, rol },
        extra: { agente: v["Agente comercial"] || null },
      });
    }
  }

  // Formas de pago
  {
    const H = "Formas de pago"; const unico = vistos(H); out[H] = [];
    for (const { fila, v } of hojas[H] ?? []) {
      if (!v["Nombre"]) { err(H, fila, "Falta el nombre"); continue; }
      const dias = numero(v["Días de crédito"] ?? "0");
      if (dias === null || Number.isNaN(dias) || dias < 0) { err(H, fila, "Días de crédito no válido"); continue; }
      if (!unico(fila, v["Nombre"], "Forma de pago")) continue;
      out[H].push({ fila, clave: v["Nombre"], datos: { nombre: v["Nombre"], dias_credito: Math.trunc(dias) } });
    }
  }

  // Líneas
  {
    const H = "Líneas"; const unico = vistos(H); out[H] = [];
    for (const { fila, v } of hojas[H] ?? []) {
      if (!v["Nombre"]) { err(H, fila, "Falta el nombre"); continue; }
      if (!unico(fila, v["Nombre"], "Línea")) continue;
      out[H].push({ fila, clave: v["Nombre"], datos: { nombre: v["Nombre"], descripcion: nulo(v["Descripción"]) } });
    }
  }

  // Proveedores
  {
    const H = "Proveedores"; const unico = vistos(H); out[H] = [];
    for (const { fila, v } of hojas[H] ?? []) {
      const ruc = soloDigitos(v["RUC"] ?? "");
      if (ruc.length !== 11) { err(H, fila, `RUC debe tener 11 dígitos (tiene ${ruc.length})`); continue; }
      if (!v["Razón social"]) { err(H, fila, "Falta la razón social"); continue; }
      const credito = numero(v["Línea de crédito"] ?? "");
      if (Number.isNaN(credito)) { err(H, fila, "Línea de crédito no es un número"); continue; }
      const mon = (v["Moneda línea"] || "PEN").toUpperCase();
      if (!["PEN", "USD"].includes(mon)) { err(H, fila, "Moneda debe ser PEN o USD"); continue; }
      if (!unico(fila, ruc, "RUC")) continue;
      out[H].push({
        fila, clave: ruc,
        datos: presentes(v, { ruc, razon_social: v["Razón social"] }, {
          direccion: ["Dirección", nulo], telefono: ["Teléfono", nulo], email: ["Correo", nulo],
          contacto_nombre: ["Persona de contacto", nulo], contacto_doc: ["Doc contacto", (x) => nulo(x.slice(0, 15))],
          contacto_cargo: ["Cargo", nulo], contacto_email: ["Correo contacto", nulo],
          contacto_telefono: ["Teléfono contacto", nulo], linea_credito: ["Línea de crédito", () => credito ?? 0],
          moneda_credito: ["Moneda línea", () => mon], notas: ["Notas", nulo],
        }),
      });
    }
  }

  // Artículos
  {
    const H = "Artículos"; const unico = vistos(H); out[H] = [];
    for (const { fila, v } of hojas[H] ?? []) {
      const codigo = (v["Código"] ?? "").toUpperCase().slice(0, 30);
      if (!codigo) { err(H, fila, "Falta el código"); continue; }
      if (!v["Descripción"]) { err(H, fila, "Falta la descripción"); continue; }
      const und = normalizarUnidad(v["Unidad"]);
      if (und.length > 20) { err(H, fila, "La unidad no debe pasar de 20 caracteres"); continue; }
      const stock = numero(v["Stock referencial"] ?? "");
      if (Number.isNaN(stock)) { err(H, fila, "Stock no es un número"); continue; }
      if (!unico(fila, codigo, "Código")) continue;
      out[H].push({
        fila, clave: codigo,
        datos: { codigo, descripcion: v["Descripción"], detalle: nulo(v["Detalle"]), unidad: und, stock_ref: stock },
        extra: { linea: v["Línea"] || null },
      });
    }
  }

  // Precios
  {
    const H = "Precios"; const unico = vistos(H); out[H] = [];
    const codigos = new Set((out["Artículos"] ?? []).map((a) => a.clave));
    const rucs = new Set((out["Proveedores"] ?? []).map((p) => p.clave));
    for (const { fila, v } of hojas[H] ?? []) {
      const codigo = (v["Código artículo"] ?? "").toUpperCase();
      const ruc = soloDigitos(v["RUC proveedor"] ?? "");
      if (!codigo || ruc.length !== 11) { err(H, fila, "Falta el código del artículo o el RUC del proveedor"); continue; }
      const venta = numero(v["Precio venta"] ?? "");
      const costo = numero(v["Precio costo"] ?? "");
      if (venta === null || Number.isNaN(venta) || venta < 0) { err(H, fila, "Precio de venta no válido"); continue; }
      if (Number.isNaN(costo) || (costo ?? 0) < 0) { err(H, fila, "Precio de costo no válido"); continue; }
      const mon = (v["Moneda"] || "PEN").toUpperCase();
      if (!["PEN", "USD"].includes(mon)) { err(H, fila, "Moneda debe ser PEN o USD"); continue; }
      if (!unico(fila, `${codigo}|${ruc}`, "Artículo + proveedor")) continue;
      out[H].push({
        fila, clave: `${codigo}|${ruc}`,
        datos: { precio_compra: costo ?? 0, precio_venta: venta, moneda: mon, preferido: sinTildes(v["Preferido"] ?? "") === "si" },
        extra: { codigo, ruc, codigoEnHoja: codigos.has(codigo), rucEnHoja: rucs.has(ruc) },
      });
    }
  }

  // Clientes
  {
    const H = "Clientes"; const unico = vistos(H); out[H] = [];
    for (const { fila, v } of hojas[H] ?? []) {
      // Solo se cotiza a empresas: el documento siempre es RUC
      const tipoDoc = (v["Tipo de documento"] || "RUC").toUpperCase();
      if (tipoDoc !== "RUC") { err(H, fila, "Solo se registran empresas: el documento debe ser RUC"); continue; }
      const doc = soloDigitos(v["Número de documento"] ?? "");
      if (!doc) { err(H, fila, "Falta el RUC"); continue; }
      if (doc.length !== 11) { err(H, fila, `RUC "${doc}" debe tener 11 dígitos (tiene ${doc.length})`); continue; }
      if (!v["Nombre o razón social"]) { err(H, fila, "Falta el nombre o razón social"); continue; }
      const tp = "juridica"; // solo empresas
      const cat = sinTildes(v["Categoría"] || "potencial");
      if (!["regular", "potencial", "inactivo"].includes(cat)) { err(H, fila, "Categoría debe ser Regular, Potencial o Inactivo"); continue; }
      if (!unico(fila, `${tipoDoc}|${doc}`, "Documento")) continue;
      out[H].push({
        fila, clave: `${tipoDoc}|${doc}`,
        datos: presentes(v, { tipo_persona: tp, tipo_doc: tipoDoc, num_doc: doc, nombre: v["Nombre o razón social"] }, {
          direccion: ["Dirección", nulo], telefono: ["Teléfono", nulo], email: ["Correo", nulo],
          contacto_nombre: ["Persona de contacto", nulo], contacto_doc: ["Doc contacto", (x) => nulo(x.slice(0, 15))],
          contacto_cargo: ["Cargo", nulo], contacto_telefono: ["Teléfono contacto", nulo],
          contacto_email: ["Correo contacto", nulo], categoria: ["Categoría", () => cat], notas: ["Notas", nulo],
        }),
        extra: { agente: v["Agente asignado"] || null },
      });
    }
  }

  return { registros: out, errores };
}

// ---------------------------------------------------------------------------
// Vista previa: cuántos son nuevos y cuántos actualizan registros existentes
// ---------------------------------------------------------------------------
export async function previsualizar(supabase: SupabaseClient, registros: Record<string, Registro[]>, errores: ErrorFila[]) {
  const existentes = async (tabla: string, campo: string, claves: string[], norm = (s: string) => s.toLowerCase()) => {
    if (!claves.length) return new Set<string>();
    // Toda la tabla por páginas (la API corta en 1000 filas); los nombres se comparan sin mayúsculas
    const data = await todasLasFilas<Record<string, string>>((a, b) =>
      supabase.from(tabla).select(campo).order("id").range(a, b) as unknown as PromiseLike<{ data: Record<string, string>[] | null; error: { message: string } | null }>);
    const set = new Set(data.map((r) => norm(String(r[campo]))));
    return new Set(claves.filter((c) => set.has(norm(c))));
  };
  const r = registros;
  const ex: Record<string, Set<string>> = {
    Empresa: await existentes("empresas", "ruc", (r.Empresa ?? []).map((x) => x.clave)),
    Agentes: await existentes("agentes", "nombre", (r.Agentes ?? []).map((x) => x.clave)),
    Usuarios: await existentes("perfiles", "email", (r.Usuarios ?? []).map((x) => x.clave)),
    "Formas de pago": await existentes("formas_pago", "nombre", (r["Formas de pago"] ?? []).map((x) => x.clave)),
    Líneas: await existentes("lineas", "nombre", (r["Líneas"] ?? []).map((x) => x.clave)),
    Proveedores: await existentes("proveedores", "ruc", (r.Proveedores ?? []).map((x) => x.clave)),
    Artículos: await existentes("articulos", "codigo", (r["Artículos"] ?? []).map((x) => x.clave)),
  };
  // clientes: clave compuesta
  {
    const data = await todasLasFilas((a, b) => supabase.from("clientes").select("tipo_doc, num_doc").order("id").range(a, b));
    const set = new Set(data.map((c) => `${c.tipo_doc}|${c.num_doc}`.toLowerCase()));
    ex.Clientes = new Set((r.Clientes ?? []).map((x) => x.clave).filter((k) => set.has(k.toLowerCase())));
  }
  // precios: validar que artículo y proveedor existan (en la hoja o en la base)
  const precios = r.Precios ?? [];
  if (precios.length) {
    const [arts, provs] = await Promise.all([
      todasLasFilas((a, b) => supabase.from("articulos").select("codigo").order("id").range(a, b)),
      todasLasFilas((a, b) => supabase.from("proveedores").select("ruc").order("id").range(a, b)),
    ]);
    const codigos = new Set(arts.map((a) => a.codigo.toUpperCase()));
    const rucs = new Set(provs.map((p) => p.ruc));
    r.Precios = precios.filter((p) => {
      const e = p.extra!;
      if (!e.codigoEnHoja && !codigos.has(String(e.codigo))) {
        errores.push({ hoja: "Precios", fila: p.fila, mensaje: `El artículo ${e.codigo} no existe en la hoja Artículos ni en el sistema` });
        return false;
      }
      if (!e.rucEnHoja && !rucs.has(String(e.ruc))) {
        errores.push({ hoja: "Precios", fila: p.fila, mensaje: `El proveedor ${e.ruc} no existe en la hoja Proveedores ni en el sistema` });
        return false;
      }
      return true;
    });
  }

  // usuarios: el rol debe existir en la tabla roles
  if (r.Usuarios?.length) {
    const roles = await rolesPorNombre(supabase);
    r.Usuarios = r.Usuarios.filter((u) => {
      const rol = String((u.datos as { rol: string }).rol);
      if (roles.has(sinTildes(rol))) return true;
      errores.push({ hoja: "Usuarios", fila: u.fila, mensaje: `El rol "${rol}" no existe. Créalo en Configuración > Roles y permisos o usa uno existente` });
      return false;
    });
  }

  const resumen: ResumenHoja[] = ORDEN_HOJAS.filter((h) => r[h]).map((h) => {
    const regs = r[h] ?? [];
    const exist = h === "Precios" ? 0 : regs.filter((x) => ex[h]?.has(x.clave)).length;
    return {
      hoja: h,
      filas: regs.length,
      nuevos: regs.length - exist,
      existentes: exist,
      errores: errores.filter((e) => e.hoja === h).length,
    };
  });
  return resumen;
}

/** Roles por nombre normalizado (sin tildes ni mayúsculas) → id */
async function rolesPorNombre(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("roles").select("id, nombre");
  if (error) throw new Error("Roles: " + error.message);
  return new Map((data ?? []).map((x) => [sinTildes(String(x.nombre)), x.id as string]));
}

// ---------------------------------------------------------------------------
// Importación: en orden de dependencias, actualizando lo que ya existe
// ---------------------------------------------------------------------------
export async function ejecutarImportacion(
  supabase: SupabaseClient,
  admin: SupabaseClient | null,
  registros: Record<string, Registro[]>,
  fotos: Map<string, Foto> = new Map(),
) {
  const log: string[] = [];
  const fallo = (h: string, msg: string) => { throw new Error(`${h}: ${msg}`); };
  const lote = <T,>(arr: T[], n = 500) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  const r = registros;

  // Empresa
  for (const x of r.Empresa ?? []) {
    const { error } = await supabase.from("empresas").upsert(x.datos, { onConflict: "ruc" });
    if (error) fallo("Empresa", error.message);
  }
  if (r.Empresa?.length) log.push(`${r.Empresa.length} empresa(s)`);

  // Agentes (sin clave única en BD: se busca por nombre)
  const agentesBD = await todasLasFilas((a, b) => supabase.from("agentes").select("id, nombre").order("id").range(a, b));
  const agentes = new Map(agentesBD.map((a) => [a.nombre.toLowerCase(), a.id as string]));
  for (const x of r.Agentes ?? []) {
    const id = agentes.get(x.clave.toLowerCase());
    const { data, error } = id
      ? await supabase.from("agentes").update(x.datos).eq("id", id).select("id").single()
      : await supabase.from("agentes").insert(x.datos).select("id").single();
    if (error) fallo("Agentes", error.message);
    agentes.set(x.clave.toLowerCase(), data!.id);
  }
  if (r.Agentes?.length) log.push(`${r.Agentes.length} agente(s)`);

  for (const [h, tabla] of [["Formas de pago", "formas_pago"], ["Líneas", "lineas"]] as const) {
    if (!r[h]?.length) continue;
    const { error } = await supabase.from(tabla).upsert(r[h].map((x) => x.datos), { onConflict: "nombre" });
    if (error) fallo(h, error.message);
    log.push(`${r[h].length} ${h.toLowerCase()}`);
  }

  for (const grupo of lote(r.Proveedores ?? [])) {
    const { error } = await supabase.from("proveedores").upsert(grupo.map((x) => x.datos), { onConflict: "ruc" });
    if (error) fallo("Proveedores", error.message);
  }
  if (r.Proveedores?.length) log.push(`${r.Proveedores.length} proveedor(es)`);

  // Artículos: la línea se resuelve por nombre y se crea si no existe
  if (r["Artículos"]?.length) {
    const nombresLinea = [...new Set(r["Artículos"].map((x) => x.extra?.linea as string | null).filter(Boolean))] as string[];
    const lineasBD = await todasLasFilas((a, b) => supabase.from("lineas").select("id, nombre").order("id").range(a, b));
    const lineas = new Map(lineasBD.map((l) => [l.nombre.toLowerCase(), l.id as string]));
    const faltan = nombresLinea.filter((n) => !lineas.has(n.toLowerCase()));
    if (faltan.length) {
      const { data, error } = await supabase.from("lineas").insert(faltan.map((nombre) => ({ nombre }))).select("id, nombre");
      if (error) fallo("Líneas", error.message);
      for (const l of data ?? []) lineas.set(l.nombre.toLowerCase(), l.id);
      log.push(`${faltan.length} línea(s) creadas desde Artículos`);
    }
    for (const grupo of lote(r["Artículos"])) {
      const filas = grupo.map((x) => ({
        ...x.datos,
        linea_id: x.extra?.linea ? lineas.get(String(x.extra.linea).toLowerCase()) ?? null : null,
      }));
      const { error } = await supabase.from("articulos").upsert(filas, { onConflict: "codigo" });
      if (error) fallo("Artículos", error.message);
    }
    log.push(`${r["Artículos"].length} artículo(s)`);

    // Fotos incrustadas en el Excel → Storage
    const validos = new Set(r["Artículos"].map((x) => x.clave));
    let subidas = 0;
    for (const [codigo, foto] of fotos) {
      if (!validos.has(codigo)) continue;
      const ext = ["jpeg", "jpg"].includes(foto.ext) ? "jpg" : foto.ext;
      const path = `articulos/${codigo.replace(/[^A-Z0-9_-]/gi, "_")}-${Date.now()}.${ext}`;
      const { error: eUp } = await supabase.storage.from("media").upload(path, foto.buffer, {
        contentType: ext === "jpg" ? "image/jpeg" : `image/${ext}`,
        upsert: true,
      });
      if (eUp) { log.push(`No se pudo subir la foto de ${codigo}: ${eUp.message}`); continue; }
      const url = supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
      const { error: eFoto } = await supabase.from("articulos").update({ foto_url: url }).eq("codigo", codigo);
      if (eFoto) { log.push(`No se pudo guardar la foto de ${codigo}: ${eFoto.message}`); continue; }
      subidas++;
    }
    if (subidas) log.push(`${subidas} foto(s) de artículos`);
  }

  // Precios
  if (r.Precios?.length) {
    const [arts, provs] = await Promise.all([
      todasLasFilas((a, b) => supabase.from("articulos").select("id, codigo").order("id").range(a, b)),
      todasLasFilas((a, b) => supabase.from("proveedores").select("id, ruc").order("id").range(a, b)),
    ]);
    const artId = new Map(arts.map((a) => [a.codigo.toUpperCase(), a.id as string]));
    const provId = new Map(provs.map((p) => [p.ruc, p.id as string]));
    const filas = r.Precios.map((x) => ({
      ...(x.datos as { precio_compra: number; precio_venta: number; moneda: string; preferido: boolean }),
      articulo_id: artId.get(String(x.extra!.codigo)),
      proveedor_id: provId.get(String(x.extra!.ruc)),
    })).filter((f) => f.articulo_id && f.proveedor_id);
    // un solo preferido por artículo: el último marcado gana
    const pref = new Map<string, number>();
    filas.forEach((f, i) => f.preferido && pref.set(f.articulo_id!, i));
    filas.forEach((f, i) => (f.preferido = pref.get(f.articulo_id!) === i));
    const conPref = [...pref.keys()];
    for (const g of lote(conPref, 200)) {
      await supabase.from("articulo_proveedor").update({ preferido: false }).in("articulo_id", g);
    }
    for (const grupo of lote(filas)) {
      const { error } = await supabase.from("articulo_proveedor").upsert(grupo, { onConflict: "articulo_id,proveedor_id" });
      if (error) fallo("Precios", error.message);
    }
    log.push(`${filas.length} precio(s) por proveedor`);
  }

  // Clientes
  if (r.Clientes?.length) {
    for (const grupo of lote(r.Clientes)) {
      const filas = grupo.map((x) => ({
        ...x.datos,
        agente_id: x.extra?.agente ? agentes.get(String(x.extra.agente).toLowerCase()) ?? null : null,
      }));
      const { error } = await supabase.from("clientes").upsert(filas, { onConflict: "tipo_doc,num_doc" });
      if (error) fallo("Clientes", error.message);
    }
    log.push(`${r.Clientes.length} cliente(s)`);
  }

  // Usuarios: se crean con contraseña temporal que el administrador debe compartir
  const credenciales: { nombre: string; email: string; password: string | null; estado: string }[] = [];
  if (r.Usuarios?.length) {
    if (!admin) fallo("Usuarios", "Falta SUPABASE_SECRET_KEY para crear usuarios");
    const perfiles = await todasLasFilas((a, b) => supabase.from("perfiles").select("id, email").order("id").range(a, b));
    const porEmail = new Map(perfiles.map((p) => [String(p.email).toLowerCase(), p.id as string]));
    const roles = await rolesPorNombre(supabase);
    for (const x of r.Usuarios) {
      const d = x.datos as { nombre: string; email: string; rol: string };
      const agente_id = x.extra?.agente ? agentes.get(String(x.extra.agente).toLowerCase()) ?? null : null;
      const rol_id = roles.get(sinTildes(d.rol));
      if (!rol_id) { credenciales.push({ nombre: d.nombre, email: d.email, password: null, estado: `Error: el rol "${d.rol}" no existe` }); continue; }
      let id = porEmail.get(d.email);
      let password: string | null = null;
      if (!id) {
        password = contrasenaTemporal();
        const { data, error } = await admin!.auth.admin.createUser({
          email: d.email, password, email_confirm: true, user_metadata: { nombre: d.nombre, rol: d.rol },
        });
        if (error) { credenciales.push({ nombre: d.nombre, email: d.email, password: null, estado: `Error: ${error.message}` }); continue; }
        id = data.user.id;
      }
      // rol_id manda (el trigger perfiles_sync_rol ajusta "rol"). Los creados aquí quedan activos;
      // a uno que ya existía no se le cambia "activo" (pudo ser desactivado a propósito).
      const cambios = { nombre: d.nombre, rol_id, agente_id, ...(password ? { activo: true } : {}) };
      const { error: ePerfil } = await supabase.from("perfiles").update(cambios).eq("id", id);
      if (ePerfil) {
        credenciales.push({ nombre: d.nombre, email: d.email, password: null, estado: `Error al guardar el perfil: ${ePerfil.message}` });
        continue;
      }
      credenciales.push({ nombre: d.nombre, email: d.email, password, estado: password ? "Creado" : "Ya existía (actualizado)" });
    }
    log.push(`${r.Usuarios.length} usuario(s)`);
  }

  return { log, credenciales };
}

function contrasenaTemporal() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("") + "!";
}
