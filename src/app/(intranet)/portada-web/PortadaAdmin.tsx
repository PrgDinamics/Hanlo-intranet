"use client";
/* eslint-disable @next/next/no-img-element -- imágenes servidas desde el cPanel de la web o Supabase, no por Next */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Package, RotateCcw, Save, Undo2 } from "lucide-react";
import { useConfirmar } from "@/components/ui/Confirmar";
import { fotoDeArticulo, guardarPortada, volverPortadaDeSiempre } from "@/lib/acciones-portada-web";
import { prepararImagenPortada } from "@/lib/imagen-portada";
import { CASILLEROS, CATEGORIAS_WEB, MAX_ETIQUETA_TEXTO, MAX_ETIQUETA_TITULO, type PortadaWeb } from "@/lib/portada-web";
import ui from "@/components/ui/ui.module.css";
import s from "./portada.module.css";

type Modo = "igual" | "siempre" | "subir" | "articulo";
type Casilla = { modo: Modo; ver: string | null; blob?: Blob; codigo?: string; detalle?: string };

export function PortadaAdmin({ sitio, portada, revistas, errorInicial }: {
  sitio: string; portada: PortadaWeb | null; revistas: { slug: string; titulo: string }[]; errorInicial: string | null;
}) {
  const router = useRouter();
  const confirmar = useConfirmar();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(errorInicial);
  const [ok, setOk] = useState<string | null>(null);
  const completa = (f: string | null | undefined) => (!f ? null : f.startsWith("/") ? `${sitio}${f}` : f);
  const inicial = (): Casilla[] => CASILLEROS.map((_, i) => {
    const im = portada?.imagenes?.[i];
    return { modo: "igual", ver: completa(im?.foto), codigo: im?.codigo ?? undefined };
  });
  const [casillas, setCasillas] = useState<Casilla[]>(inicial);
  const [sel, setSel] = useState(2);
  // Sin portada.json la web muestra "Eco / Línea nature": se parte de eso
  const [titulo, setTitulo] = useState(portada ? portada.etiqueta?.titulo ?? "" : "Eco");
  const [texto, setTexto] = useState(portada ? portada.etiqueta?.texto ?? "" : "Línea nature");
  const enlaceInicial = () => {
    const e = portada?.etiqueta?.enlace ?? "";
    const r = e.match(/^\/revistas\/([^/]+)\/?$/); if (r) return `revista:${r[1]}`;
    const c = e.match(/^\/productos\/([^/]+)\/?$/); if (c) return `categoria:${c[1]}`;
    return "";
  };
  const [enlace, setEnlace] = useState(enlaceInicial);
  const [codigo, setCodigo] = useState("");
  const tipoEnlace = enlace.split(":")[0];
  const cambiar = (i: number, c: Casilla) => setCasillas((l) => l.map((x, k) => (k === i ? c : x)));
  const actual = casillas[sel];

  const usarArticulo = () => start(async () => {
    setError(null);
    const r = await fotoDeArticulo(codigo);
    if (!r.ok) return setError(r.error);
    cambiar(sel, { modo: "articulo", ver: r.foto, codigo: codigo.trim().toUpperCase(), detalle: r.descripcion });
    setCodigo("");
  });

  const guardar = () => start(async () => {
    setError(null); setOk(null);
    const fd = new FormData();
    casillas.forEach((c, i) => {
      const n = i + 1;
      fd.append(`modo${n}`, c.modo);
      if (c.modo === "subir" && c.blob) fd.append(`archivo${n}`, c.blob, `${n}.jpg`);
      if (c.modo === "articulo" && c.codigo) fd.append(`codigo${n}`, c.codigo);
    });
    fd.append("titulo", titulo); fd.append("texto", texto); fd.append("enlace", enlace);
    const r = await guardarPortada(fd);
    if (!r.ok) return setError(r.error);
    setOk("Portada publicada en la web");
    setCasillas((l) => l.map((c) => ({ ...c, modo: "igual" as Modo })));
    router.refresh();
  });

  const deSiempre = async () => {
    if (!(await confirmar({ titulo: "Volver a la portada de siempre", mensaje: "La web vuelve a sus imágenes y a la etiqueta \"Eco / Línea nature\". Se borran las imágenes que subiste.", peligro: true, aceptar: "Volver a la de siempre" }))) return;
    start(async () => {
      setError(null); setOk(null);
      const r = await volverPortadaDeSiempre();
      if (!r.ok) return setError(r.error);
      setCasillas(CASILLEROS.map(() => ({ modo: "igual" as Modo, ver: null })));
      setTitulo("Eco"); setTexto("Línea nature"); setEnlace("");
      setOk("La web volvió a su portada de siempre");
      router.refresh();
    });
  };

  return (
    <div className={ui.stack}>
      {error && <div className={ui.alert}>{error}</div>}
      {ok && <div className={`${ui.alert} ${ui.alertOk}`}>{ok}</div>}
      <div className={s.layout}>
        <div className={ui.card}>
          <div className={ui.cardHead}><span className={ui.cardTitle}>Vista previa</span></div>
          <div className={s.escena}>
            <div className={s.circulo} />
            {casillas.map((c, i) => (
              <button key={i} type="button" className={`${s.casilla} ${s[`c${i + 1}`]} ${sel === i ? s.sel : ""}`}
                title={CASILLEROS[i]} onClick={() => setSel(i)}>
                <span className={s.num}>{i + 1}</span>
                {c.modo !== "siempre" && c.ver ? <img src={c.ver} alt={`Imagen ${i + 1}`} /> : <span>Imagen de siempre</span>}
              </button>
            ))}
            {(titulo || texto) && <div className={s.etiqueta}><b>{titulo}</b><span>{texto}</span></div>}
          </div>
        </div>

        <div className={ui.stack}>
          <div className={ui.card}>
            <div className={ui.cardHead}><span className={ui.cardTitle}>Imagen {sel + 1} · {CASILLEROS[sel]}</span></div>
            <div className={`${ui.cardBody} ${s.editor}`}>
              <div className={s.opciones}>
                <label className={`${ui.btn} ${s.subir}`}>
                  <ImageUp /> Subir imagen
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={async (e) => {
                    const f = e.target.files?.[0]; e.target.value = "";
                    if (!f) return;
                    const r = await prepararImagenPortada(f);
                    if (!r.ok) return setError(r.error);
                    setError(null);
                    cambiar(sel, { modo: "subir", ver: r.url, blob: r.jpg });
                  }} />
                </label>
                <button type="button" className={ui.btn} aria-pressed={actual.modo === "siempre" || (!actual.ver && actual.modo === "igual")}
                  onClick={() => cambiar(sel, { modo: "siempre", ver: null })}><Undo2 /> Usar la de siempre</button>
              </div>
              <span className={ui.label}>O usa la foto de un artículo: escribe su código</span>
              <div className={s.fila}>
                <input className={ui.input} value={codigo} onChange={(e) => setCodigo(e.target.value)} aria-label="Código del artículo"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); usarArticulo(); } }} />
                <button type="button" className={ui.btn} disabled={pending || !codigo.trim()} onClick={usarArticulo}><Package /> Usar artículo</button>
              </div>
              <p className={s.hint}>
                {actual.modo === "articulo" ? `Foto del artículo ${actual.codigo}${actual.detalle ? ` · ${actual.detalle}` : ""}.`
                  : actual.modo === "subir" ? "Imagen nueva (se publica al guardar)."
                  : actual.modo === "siempre" || !actual.ver ? "Usa la imagen de siempre de la web."
                  : actual.codigo ? `Foto del artículo ${actual.codigo}.` : "Imagen subida."}
                {" "}Mejor una imagen casi cuadrada de producto sobre fondo blanco. Se deja de 800 px en JPG.
                Haz clic en otra imagen de la vista previa para cambiarla.
              </p>
            </div>
          </div>

          <div className={ui.card}>
            <div className={ui.cardHead}><span className={ui.cardTitle}>Etiqueta</span></div>
            <div className={`${ui.cardBody} ${ui.grid}`}>
              <label className={`${ui.field} ${ui.span6}`}>
                <span className={ui.label}>Texto grande <span className={s.cuenta}>{titulo.length}/{MAX_ETIQUETA_TITULO}</span></span>
                <input className={ui.input} value={titulo} maxLength={MAX_ETIQUETA_TITULO} onChange={(e) => setTitulo(e.target.value)} />
              </label>
              <label className={`${ui.field} ${ui.span6}`}>
                <span className={ui.label}>Texto pequeño <span className={s.cuenta}>{texto.length}/{MAX_ETIQUETA_TEXTO}</span></span>
                <input className={ui.input} value={texto} maxLength={MAX_ETIQUETA_TEXTO} onChange={(e) => setTexto(e.target.value)} />
              </label>
              <label className={`${ui.field} ${ui.span6}`}>
                <span className={ui.label}>Al hacer clic en la etiqueta</span>
                <select className={ui.input} value={tipoEnlace} onChange={(e) => setEnlace(
                  e.target.value === "revista" ? (revistas[0] ? `revista:${revistas[0].slug}` : "")
                    : e.target.value === "categoria" ? `categoria:${CATEGORIAS_WEB[0].slug}` : "")}>
                  <option value="">Sin enlace</option>
                  <option value="revista" disabled={!revistas.length}>Abre una revista publicada</option>
                  <option value="categoria">Abre una categoría del catálogo</option>
                </select>
              </label>
              {tipoEnlace === "revista" && (
                <label className={`${ui.field} ${ui.span6}`}>
                  <span className={ui.label}>Revista</span>
                  <select className={ui.input} value={enlace.slice(8)} onChange={(e) => setEnlace(`revista:${e.target.value}`)}>
                    {revistas.map((r) => <option key={r.slug} value={r.slug}>{r.titulo}</option>)}
                  </select>
                </label>
              )}
              {tipoEnlace === "categoria" && (
                <label className={`${ui.field} ${ui.span6}`}>
                  <span className={ui.label}>Categoría</span>
                  <select className={ui.input} value={enlace.slice(10)} onChange={(e) => setEnlace(`categoria:${e.target.value}`)}>
                    {CATEGORIAS_WEB.map((c) => <option key={c.slug} value={c.slug}>{c.nombre}</option>)}
                  </select>
                </label>
              )}
              <p className={`${ui.span12} ${s.hint}`}>Si dejas los dos textos vacíos, la etiqueta no se muestra.</p>
            </div>
          </div>

          <div className={s.fila} style={{ justifyContent: "space-between" }}>
            <button type="button" className={`${ui.btn} ${ui.ghost}`} disabled={pending} onClick={deSiempre}><RotateCcw /> Volver a la de siempre</button>
            <button type="button" className={`${ui.btn} ${ui.primary}`} disabled={pending} onClick={guardar}><Save /> {pending ? "Publicando..." : "Publicar portada"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
