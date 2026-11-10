"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, CheckCircle2, FileSpreadsheet, Plus, ScanSearch, Upload } from "lucide-react";
import { analizarLista, importarListaProveedor, type AnalisisLista } from "@/lib/acciones-importar";
import { prepararYSubir } from "@/lib/aligerar-excel";
import { Combobox, type ComboOpcion } from "@/components/ui/Combobox";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { RegistroForm } from "@/components/crud/RegistroForm";
import { num } from "@/lib/format";
import ui from "@/components/ui/ui.module.css";
import s from "./importar.module.css";

export function ListaProveedor({
  proveedores, consulta, igvProveedor,
}: {
  proveedores: ComboOpcion[];
  consulta: boolean;
  /** Lo que cada proveedor tiene guardado: sus listas traen precios con IGV (true), sin IGV (false) o sin definir */
  igvProveedor: Record<string, boolean | null>;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [proveedor, setProveedor] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [ruta, setRuta] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState<AnalisisLista | null>(null);
  const [resultado, setResultado] = useState<{ ok: true; log: string[] } | { ok: false; error: string } | null>(null);
  const [ceroSiNoEsta, setCeroSiNoEsta] = useState(true);
  const [nuevoProv, setNuevoProv] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [pending, start] = useTransition();
  const [fase, setFase] = useState("");
  const [nota, setNota] = useState<string | null>(null);
  // ¿Los precios de esta lista incluyen IGV? null = falta elegir
  const [incluyeIgv, setIncluyeIgv] = useState<boolean | null>(null);
  const [igvOrigen, setIgvOrigen] = useState<string | null>(null);

  /**
   * Siempre se pregunta (nada viene marcado). Solo se muestra una pista: lo que dice el archivo
   * o lo que se eligió la última vez para ese proveedor.
   */
  const sugerirIgv = (a: AnalisisLista | null, provId: string) => {
    setIncluyeIgv(null);
    const ultimo = provId ? igvProveedor[provId] : null;
    if (a?.ok && a.igvArchivo) setIgvOrigen(`Pista: ${a.igvMotivo?.toLowerCase()}`);
    else if (ultimo != null) setIgvOrigen(`Pista: la última lista de este proveedor ${ultimo ? "incluía" : "no incluía"} IGV`);
    else setIgvOrigen(null);
  };
  const cambiarProveedor = (id: string) => {
    setProveedor(id);
    sugerirIgv(analisis, id);
  };

  const elegir = (f: File | undefined | null) => {
    if (!f) return;
    setArchivo(f);
    setResultado(null);
    setAnalisis(null);
    setNota(null);
    start(async () => {
      const sub = await prepararYSubir(f, setFase);
      if (!sub.ok) { setFase(""); return setAnalisis({ ok: false, error: sub.error }); }
      const nombre = sub.ruta;
      setNota(sub.nota);
      setRuta(nombre);
      setFase("Leyendo hojas, colores y fotos...");
      const a = await analizarLista(nombre, f.name);
      setAnalisis(a);
      sugerirIgv(a, proveedor);
      setFase("");
    });
  };

  const importar = () => {
    if (!ruta) return;
    start(async () => {
      setFase("Importando precios, stock y fotos. Puede tardar un par de minutos...");
      setResultado(await importarListaProveedor(ruta, proveedor, ceroSiNoEsta, incluyeIgv));
      setFase("");
      router.refresh();
    });
  };

  const ok = analisis?.ok ? analisis : null;

  return (
    <div className={ui.stack}>
      <p className={ui.muted}>
        Sube la lista de stock que envía el proveedor (STOCK CLIENTES, AdminPlus, Promos, Tienda Publicitaria, etc.). Cada hoja se toma
        como una línea; se cargan los precios muestra, por ciento y por millar, el stock por color y las fotos.
        Los artículos que ya existen solo actualizan precio y stock de este proveedor.
      </p>

      <div className={s.listaTop}>
        <div className={ui.field} style={{ flex: 1 }}>
          <span className={`${ui.label} ${ui.req}`}>Proveedor de esta lista</span>
          <div className={ui.row}>
            <div style={{ flex: 1 }}>
              <Combobox options={proveedores} value={proveedor} onChange={cambiarProveedor} placeholder="Buscar proveedor por nombre o RUC..." />
            </div>
            <button className={ui.btn} onClick={() => setNuevoProv(true)} type="button"><Plus /> Nuevo</button>
          </div>
        </div>
        <label className={ui.check} style={{ alignSelf: "flex-end", paddingBottom: 8 }}>
          <input type="checkbox" checked={ceroSiNoEsta} onChange={(e) => setCeroSiNoEsta(e.target.checked)} />
          Lo que ya no aparece en la lista queda con stock 0
        </label>
      </div>

      <div
        className={`${s.drop} ${arrastrando ? s.dropOn : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastrando(false); elegir(e.dataTransfer.files?.[0]); }}
        role="button"
        tabIndex={0}
      >
        <FileSpreadsheet />
        <strong>{archivo ? archivo.name : "Arrastra aquí la lista de stock (.xlsx)"}</strong>
        <span>{fase || (archivo ? "Haz clic o arrastra otro archivo para reemplazarlo" : "o haz clic para elegir el archivo")}</span>
        <input ref={input} type="file" accept=".xlsx" hidden onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      {nota && <p className={ui.hint}><CheckCircle2 style={{ width: 14, height: 14, verticalAlign: -2, color: "var(--ok)" }} /> {nota}</p>}

      {analisis && !analisis.ok && <div className={ui.alert}><AlertCircle /> {analisis.error}</div>}

      {ok && !resultado?.ok && (
        <div className={ui.card}>
          <div className={ui.cardHead}>
            <span className={ui.cardTitle}>
              <ScanSearch /> Vista previa
              <span className={ui.muted} style={{ fontWeight: 400 }}>
                · {ok.productos} productos · {ok.nuevos} nuevos · {ok.existentes} ya existen · stock total {num(ok.stockTotal, 0)}
              </span>
            </span>
            <button className={`${ui.btn} ${ui.primary}`} onClick={importar} disabled={pending || !proveedor || incluyeIgv === null}
              title={!proveedor ? "Elige primero el proveedor" : incluyeIgv === null ? "Indica si los precios incluyen IGV" : ""}>
              <Upload /> {pending ? "Importando..." : "Importar lista"}
            </button>
          </div>
          {!proveedor && (
            <div style={{ padding: "12px 18px 0" }}>
              <div className={ui.alert}><AlertCircle /> Elige arriba a qué proveedor pertenece esta lista para poder importarla.</div>
            </div>
          )}
          <div className={`${s.igvBox} ${incluyeIgv === null ? s.igvFalta : ""}`}>
            <div className={s.igvTitulo}>
              <strong>¿Los precios de esta lista incluyen IGV?</strong>
              {igvOrigen && <span className={ui.muted}>{igvOrigen}</span>}
            </div>
            <div className={s.igvOpciones}>
              <label className={`${s.igvOpcion} ${incluyeIgv === false ? s.igvSel : ""}`}>
                <input type="radio" name="igv" checked={incluyeIgv === false} onChange={() => setIncluyeIgv(false)} />
                <span><strong>No incluyen IGV · más IGV</strong><small>Se guardan tal cual</small></span>
              </label>
              <label className={`${s.igvOpcion} ${incluyeIgv === true ? s.igvSel : ""}`}>
                <input type="radio" name="igv" checked={incluyeIgv === true} onChange={() => setIncluyeIgv(true)} />
                <span><strong>Incluyen IGV</strong><small>Se guardan sin IGV (÷ 1.18), porque el IGV se suma en la cotización</small></span>
              </label>
            </div>
            {ok.ejemplo && incluyeIgv !== null && (
              <p className={ui.hint}>
                Ejemplo: {ok.ejemplo.descripcion} · precio de la lista S/ {num(ok.ejemplo.precio, 2)} → se guarda como costo
                {" "}<strong>S/ {num(incluyeIgv ? ok.ejemplo.precio / 1.18 : ok.ejemplo.precio, 2)}</strong> sin IGV
              </p>
            )}
            {incluyeIgv === null && <p className={ui.hint} style={{ color: "var(--danger)" }}>Elige una opción para poder importar. Revisa la lista o pregúntale al proveedor si no estás seguro.</p>}
          </div>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr><th>Hoja</th><th>Línea</th><th className={ui.num}>Productos</th><th className={ui.num}>Colores</th><th className={ui.num}>Fotos</th></tr>
              </thead>
              <tbody>
                {ok.hojas.map((h) => (
                  <tr key={h.nombre}>
                    <td className={ui.strong}>{h.nombre}</td>
                    <td>{h.linea}</td>
                    <td className={ui.num}>{h.productos}</td>
                    <td className={ui.num}>{h.colores}</td>
                    <td className={ui.num}>{h.fotos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ok.ignoradas.length > 0 && (
            <p className={ui.hint} style={{ padding: "10px 18px" }}>Hojas sin tabla de productos (se ignoran): {ok.ignoradas.join(", ")}</p>
          )}
          {ok.avisos.length > 0 && (
            <div className={s.errores}>
              <div className={s.errHead}><AlertTriangle /> {ok.avisos.length} aviso(s)</div>
              <ul>
                {ok.avisos.slice(0, 200).map((a, i) => (
                  <li key={i}><Badge tono="warn">{a.hoja} · fila {a.fila}</Badge> {a.mensaje}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {resultado && !resultado.ok && <div className={ui.alert}><AlertCircle /> {resultado.error}</div>}
      {resultado?.ok && (
        <div className={ui.card}>
          <div className={ui.cardHead}>
            <span className={ui.cardTitle}><CheckCircle2 style={{ color: "var(--ok)" }} /> Lista importada</span>
          </div>
          <div className={ui.cardBody}>
            <ul className={s.log}>
              {resultado.log.map((l) => <li key={l}><CheckCircle2 /> {l}</li>)}
            </ul>
          </div>
        </div>
      )}

      <Modal open={nuevoProv} onClose={() => setNuevoProv(false)} title="Nuevo proveedor">
        {nuevoProv && (
          <RegistroForm
            modKey="proveedores"
            refs={{}}
            consulta={consulta}
            compact
            onCancel={() => setNuevoProv(false)}
            onSaved={(id) => { setNuevoProv(false); cambiarProveedor(id); router.refresh(); }}
          />
        )}
      </Modal>
    </div>
  );
}
