import "server-only";
import ExcelJS from "exceljs";

export type ColExcel = {
  header: string;
  key: string;
  width?: number;
  tipo?: "text" | "money" | "int" | "num" | "pct" | "date";
};
export type HojaExcel = { nombre: string; titulo?: string; columnas: ColExcel[]; filas: Record<string, unknown>[] };

const FMT: Record<string, string> = {
  money: '"S/" #,##0.00;-"S/" #,##0.00;"-"',
  int: "#,##0",
  num: "#,##0.00",
  pct: '0.0"%"',
  date: "dd/mm/yyyy",
};

/** Genera un .xlsx con una hoja por tabla, encabezados con estilo, filtros y totales */
export async function generarExcel(hojas: HojaExcel[], subtitulo?: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Intranet Hanlo";
  wb.created = new Date();
  for (const h of hojas) {
    const ws = wb.addWorksheet(h.nombre.slice(0, 31));
    let fila = 1;
    if (h.titulo) {
      ws.getCell(1, 1).value = h.titulo;
      ws.getCell(1, 1).font = { name: "Arial", bold: true, size: 13, color: { argb: "FF0F172A" } };
      if (subtitulo) {
        ws.getCell(2, 1).value = subtitulo;
        ws.getCell(2, 1).font = { name: "Arial", size: 9, color: { argb: "FF64748B" } };
      }
      fila = 4;
    }
    const head = ws.getRow(fila);
    h.columnas.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c.header;
      cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
      cell.alignment = { vertical: "middle", horizontal: c.tipo && c.tipo !== "text" ? "right" : "left" };
      ws.getColumn(i + 1).width = c.width ?? Math.max(12, c.header.length + 4);
    });
    head.height = 20;
    h.filas.forEach((f, r) => {
      const row = ws.getRow(fila + 1 + r);
      h.columnas.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        let v = f[c.key] as unknown;
        if (c.tipo === "date" && typeof v === "string" && v) {
          const [y, m, d] = v.slice(0, 10).split("-").map(Number);
          v = new Date(Date.UTC(y, m - 1, d));
        } else if (c.tipo && !["text", "date"].includes(c.tipo) && v !== null && v !== undefined && v !== "") {
          v = Number(v);
        }
        cell.value = (v ?? null) as ExcelJS.CellValue;
        cell.font = { name: "Arial", size: 10 };
        if (c.tipo && FMT[c.tipo]) cell.numFmt = FMT[c.tipo];
      });
    });
    const ultima = fila + h.filas.length;
    // Totales para columnas de montos y cantidades
    const sumables = h.columnas.some((c, i) => c.tipo === "money" || (c.tipo === "int" && i > 0));
    if (h.filas.length && sumables) {
      const tot = ws.getRow(ultima + 1);
      tot.getCell(1).value = "Total";
      h.columnas.forEach((c, i) => {
        if (c.tipo === "money" || (c.tipo === "int" && i > 0)) {
          const col = ws.getColumn(i + 1).letter;
          const cell = tot.getCell(i + 1);
          cell.value = { formula: `SUM(${col}${fila + 1}:${col}${ultima})` };
          cell.numFmt = FMT[c.tipo];
        }
      });
      tot.eachCell((cell) => {
        cell.font = { name: "Arial", bold: true, size: 10 };
        cell.border = { top: { style: "thin", color: { argb: "FF0F172A" } } };
      });
    }
    ws.autoFilter = { from: { row: fila, column: 1 }, to: { row: Math.max(fila, ultima), column: h.columnas.length } };
    ws.views = [{ state: "frozen", ySplit: fila }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function respuestaExcel(buffer: Buffer, nombre: string) {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
