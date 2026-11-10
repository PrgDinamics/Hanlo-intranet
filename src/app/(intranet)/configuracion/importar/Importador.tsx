"use client";

import { useRef, useState, useTransition } from "react";
import {
  AlertCircle, AlertTriangle, CheckCircle2, Copy, Download, FileSpreadsheet, ScanSearch, Upload,
} from "lucide-react";
import { analizarPlantilla, importarPlantilla, type Analisis, type ResultadoImport } from "@/lib/acciones-importar";
import { Badge } from "@/components/ui/Badge";
import { prepararYSubir } from "@/lib/aligerar-excel";
import ui from "@/components/ui/ui.module.css";
import s from "./importar.module.css";

export function Importador() {
  const input = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [ruta, setRuta] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [resultado, setResultado] = useState<ResultadoImport | null>(null);
  const [pending, start] = useTransition();
  const [arrastrando, setArrastrando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [fase, setFase] = useState("");
  const [nota, setNota] = useState<string | null>(null);

  const elegir = (f: File | undefined | null) => {
    if (!f) return;
    setArchivo(f);
    setResultado(null);
    setAnalisis(null);
    setNota(null);
    start(async () => {
      // Se aligera (fotos) y se sube directo a Storage (privado) para no depender del límite del servidor
      const sub = await prepararYSubir(f, setFase);
      setFase("");
      if (!sub.ok) return setAnalisis({ ok: false, error: sub.error });
      const nombre = sub.ruta;
      setNota(sub.nota);
      setFase("Analizando...");
      setRuta(nombre);
      setAnalisis(await analizarPlantilla(nombre));
      setFase("");
    });
  };

  const importar = () => {
    if (!ruta) return;
    start(async () => setResultado(await importarPlantilla(ruta)));
  };

  const ok = analisis?.ok ? analisis : null;
  const totalValidas = ok?.resumen.reduce((a, r) => a + r.filas, 0) ?? 0;

  const copiarCredenciales = async () => {
    if (!resultado?.ok) return;
    const txt = resultado.credenciales
      .filter((c) => c.password)
      .map((c) => `${c.nombre}\nUsuario: ${c.email}\nContraseña temporal: ${c.password}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(txt);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {}
  };

  return (
    <div className={ui.stack}>
      <div className={s.pasos}>
        <div className={`${ui.card} ${s.paso}`}>
          <span className={s.num}>1</span>
          <div>
            <strong>Descarga el formato</strong>
            <p>Artículos (con foto y hasta 4 proveedores), Proveedores, Clientes y AgentesVenta, el mismo formato que usa la empresa.</p>
            <a className={`${ui.btn} ${ui.sm}`} href="/plantilla-carga-inicial.xlsx" download="Formato_carga_Hanlo.xlsx">
              <Download /> Formato_carga_Hanlo.xlsx
            </a>
          </div>
        </div>
        <div className={`${ui.card} ${s.paso}`}>
          <span className={s.num}>2</span>
          <div>
            <strong>Sube el archivo lleno</strong>
            <p>Se revisa fila por fila antes de guardar nada. Puedes subirlo las veces que quieras: lo que ya existe se actualiza.</p>
          </div>
        </div>
        <div className={`${ui.card} ${s.paso}`}>
          <span className={s.num}>3</span>
          <div>
            <strong>Confirma la importación</strong>
            <p>Se guardan las filas válidas. Las que tengan errores se omiten y puedes corregirlas y volver a subir.</p>
          </div>
        </div>
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
        {archivo ? (
          <>
            <strong>{archivo.name}</strong>
            <span>{fase || (pending && !analisis ? "Subiendo y analizando..." : "Haz clic o arrastra otro archivo para reemplazarlo")}</span>
          </>
        ) : (
          <>
            <strong>Arrastra aquí el Excel con la información (.xlsx)</strong>
            <span>o haz clic para elegir el archivo</span>
          </>
        )}
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
                · {ok.formato}{ok.fotos ? ` · ${ok.fotos} foto(s) de artículos` : ""}
              </span>
            </span>
            <button className={`${ui.btn} ${ui.primary}`} onClick={importar} disabled={pending || totalValidas === 0}>
              <Upload /> {pending ? "Importando..." : `Importar ${totalValidas} registro${totalValidas === 1 ? "" : "s"}`}
            </button>
          </div>
          <div className={ui.tableWrap}>
            <table className={ui.table}>
              <thead>
                <tr><th>Hoja</th><th className={ui.num}>Filas válidas</th><th className={ui.num}>Nuevos</th><th className={ui.num}>Se actualizan</th><th className={ui.num}>Con error</th></tr>
              </thead>
              <tbody>
                {ok.resumen.map((r) => (
                  <tr key={r.hoja}>
                    <td className={ui.strong}>{r.hoja}</td>
                    <td className={ui.num}>{r.filas}</td>
                    <td className={ui.num}>{r.nuevos ? <Badge tono="ok">{r.nuevos}</Badge> : 0}</td>
                    <td className={ui.num}>{r.existentes ? <Badge tono="info">{r.existentes}</Badge> : 0}</td>
                    <td className={ui.num}>{r.errores ? <Badge tono="danger">{r.errores}</Badge> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ok.errores.length > 0 && (
            <div className={s.errores}>
              <div className={s.errHead}><AlertTriangle /> {ok.errores.length} fila(s) con errores, se omitirán al importar</div>
              <ul>
                {ok.errores.slice(0, 200).map((e, i) => (
                  <li key={i}><Badge tono="danger">{e.hoja} · fila {e.fila}</Badge> {e.mensaje}</li>
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
            <span className={ui.cardTitle}><CheckCircle2 style={{ color: "var(--ok)" }} /> Importación completada</span>
          </div>
          <div className={ui.cardBody}>
            <ul className={s.log}>
              {resultado.log.map((l) => <li key={l}><CheckCircle2 /> {l}</li>)}
            </ul>
            {resultado.omitidas > 0 && <p className={ui.hint} style={{ marginTop: 8 }}>{resultado.omitidas} fila(s) con errores no se importaron.</p>}
          </div>
          {resultado.credenciales.length > 0 && (
            <>
              <div className={ui.cardHead} style={{ borderTop: "1px solid var(--border)" }}>
                <span className={ui.cardTitle}>Accesos de usuarios</span>
                <button className={`${ui.btn} ${ui.sm}`} onClick={copiarCredenciales}>
                  <Copy /> {copiado ? "Copiado" : "Copiar accesos nuevos"}
                </button>
              </div>
              <div className={ui.tableWrap}>
                <table className={ui.table}>
                  <thead><tr><th>Nombre</th><th>Usuario</th><th>Contraseña temporal</th><th>Estado</th></tr></thead>
                  <tbody>
                    {resultado.credenciales.map((c) => (
                      <tr key={c.email}>
                        <td>{c.nombre}</td>
                        <td>{c.email}</td>
                        <td className={ui.mono}>{c.password ?? "(sin cambios)"}</td>
                        <td>{c.estado}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={ui.hint} style={{ padding: "10px 18px 16px" }}>
                Las contraseñas temporales solo se muestran ahora. Compártelas con cada persona y pídeles que la cambien desde Usuarios.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
