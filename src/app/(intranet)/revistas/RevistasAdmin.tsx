"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Eye, EyeOff, ExternalLink, FileUp, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import {
  cambiarVisibilidadRevista, editarTituloRevista, eliminarRevista, prepararRevista, publicarRevista, subirPaginaRevista,
} from "@/lib/acciones-revistas";
import { archivoPagina, MAX_PAGINAS, rutaRevista, slugDe, validarSlug, type Revista } from "@/lib/revistas";
import { fecha } from "@/lib/format";
import ui from "@/components/ui/ui.module.css";
import s from "./revistas.module.css";

/** Ancho de cada página en píxeles: nítido al ampliar en el celular y liviano para compartir */
const ANCHO_PAGINA = 1300;
const MAX_MB_PDF = 80;

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; cerrar: () => Promise<void> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: Record<string, unknown>) => { promise: Promise<void> };
  cleanup: () => void;
};

async function abrirPdf(file: File): Promise<PdfDoc> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const tarea = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = (await tarea.promise) as unknown as Omit<PdfDoc, "cerrar">;
  return { numPages: doc.numPages, getPage: (n) => doc.getPage(n), cerrar: () => tarea.destroy() };
}

/** Dibuja una página del PDF y la convierte en JPG */
async function paginaAJpg(doc: PdfDoc, n: number) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: ANCHO_PAGINA / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  const aBlob = (q: number) => new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo convertir la página"))), "image/jpeg", q));
  let blob = await aBlob(0.82);
  if (blob.size > 2.5 * 1024 * 1024) blob = await aBlob(0.68);
  const medidas = { ancho: canvas.width, alto: canvas.height };
  // Libera la memoria del dibujo (en iPhone/iPad hay un límite y los PDF largos lo pasarían)
  canvas.width = 0;
  canvas.height = 0;
  return { blob, ...medidas };
}

type Paso = { texto: string; pct: number } | null;

export function RevistasAdmin({ sitio, revistas, errorInicial }: { sitio: string; revistas: Revista[]; errorInicial: string | null }) {
  const router = useRouter();
  const dominio = sitio.replace(/^https?:\/\//, "");
  const [titulo, setTitulo] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [portadaDe, setPortadaDe] = useState<{ file: File; url: string } | null>(null);
  const portada = archivo && portadaDe?.file === archivo ? portadaDe.url : null;
  const [arrastrando, setArrastrando] = useState(false);
  const [paso, setPaso] = useState<Paso>(null);
  const [error, setError] = useState<string | null>(errorInicial);
  const [aviso, setAviso] = useState<{ texto: string; url?: string } | null>(null);
  const [reemplazar, setReemplazar] = useState<string | null>(null);
  const [borrarSlug, setBorrarSlug] = useState<Revista | null>(null);
  const [editar, setEditar] = useState<{ r: Revista; titulo: string } | null>(null);
  const [pending, start] = useTransition();
  const ocupado = !!paso || pending;
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // Vista previa de la portada al elegir el PDF
  useEffect(() => {
    if (!archivo) return;
    let vivo = true;
    let url: string | null = null;
    (async () => {
      try {
        const doc = await abrirPdf(archivo);
        const { blob } = await paginaAJpg(doc, 1);
        await doc.cerrar();
        if (!vivo) return;
        url = URL.createObjectURL(blob);
        setPortadaDe({ file: archivo, url });
      } catch (e) {
        console.error("Revista: no se pudo leer el PDF", e);
        if (vivo) setError("No se pudo leer el PDF. Revisa que no esté dañado ni protegido con contraseña.");
      }
    })();
    return () => { vivo = false; if (url) URL.revokeObjectURL(url); };
  }, [archivo]);

  const elegir = (f: File | undefined | null) => {
    setError(null); setAviso(null);
    if (!f) return;
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) { setError("El archivo debe ser un PDF"); return; }
    if (f.size > MAX_MB_PDF * 1024 * 1024) { setError(`El PDF pesa más de ${MAX_MB_PDF} MB`); return; }
    setArchivo(f);
    if (!titulo) {
      const t = f.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
      setTitulo(t.charAt(0).toUpperCase() + t.slice(1));
      if (!slugTocado) setSlug(slugDe(t));
    }
  };

  const errSlug = slug ? validarSlug(slug) : null;
  const existe = revistas.find((r) => r.slug === slug);

  const publicar = async (confirmado = false) => {
    setError(null); setAviso(null);
    if (!archivo) { setError("Elige el PDF de la revista"); return; }
    if (!titulo.trim()) { setError("Escribe el título de la revista"); return; }
    const e = validarSlug(slug);
    if (e) { setError(e); return; }
    if (existe && !confirmado) { setReemplazar(slug); return; }
    setReemplazar(null);
    let doc: PdfDoc | null = null;
    try {
      setPaso({ texto: "Leyendo el PDF…", pct: 2 });
      doc = await abrirPdf(archivo);
      const total = doc.numPages;
      if (total > MAX_PAGINAS) throw new Error(`El PDF tiene ${total} páginas; el máximo es ${MAX_PAGINAS}`);
      const prep = await prepararRevista(slug, titulo.trim(), total);
      if (!prep.ok) throw new Error(prep.error);
      let ancho = 0, alto = 0;
      for (let n = 1; n <= total; n++) {
        setPaso({ texto: `Convirtiendo y subiendo página ${n} de ${total}…`, pct: 4 + Math.round(((n - 1) / total) * 90) });
        const img = await paginaAJpg(doc, n);
        if (n === 1) { ancho = img.ancho; alto = img.alto; }
        const fd = new FormData();
        fd.append("slug", slug); fd.append("version", prep.version); fd.append("n", String(n));
        fd.append("imagen", img.blob, archivoPagina(n, prep.version));
        // Un reintento por página: una conexión lenta no debe arruinar toda la subida
        let r = await subirPaginaRevista(fd);
        if (!r.ok) r = await subirPaginaRevista(fd);
        if (!r.ok) throw new Error(`Página ${n}: ${r.error}`);
      }
      setPaso({ texto: "Publicando…", pct: 97 });
      const pub = await publicarRevista({ slug, titulo: titulo.trim(), paginas: total, ancho, alto, version: prep.version });
      if (!pub.ok) throw new Error(pub.error);
      setAviso({ texto: `Revista publicada con ${total} páginas`, url: pub.url });
      setArchivo(null); setTitulo(""); setSlug(""); setSlugTocado(false);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPaso(null);
      await doc?.cerrar().catch(() => {});
    }
  };

  const visibilidad = (r: Revista) => start(async () => {
    setError(null); setAviso(null);
    const res = await cambiarVisibilidadRevista(r.slug, !r.activo);
    if (!res.ok) setError(res.error);
    else { setAviso({ texto: r.activo ? `"${r.titulo}" quedó oculta` : `"${r.titulo}" se ve de nuevo` }); router.refresh(); }
  });

  const eliminar = (r: Revista) => start(async () => {
    setError(null); setAviso(null);
    const res = await eliminarRevista(r.slug);
    setBorrarSlug(null);
    if (!res.ok) setError(res.error);
    else { setAviso({ texto: `"${r.titulo}" se eliminó de la web` }); router.refresh(); }
  });

  const guardarTitulo = () => editar && start(async () => {
    setError(null); setAviso(null);
    const res = await editarTituloRevista(editar.r.slug, editar.titulo);
    if (!res.ok) { setError(res.error); return; }
    setEditar(null);
    setAviso({ texto: "Título actualizado" });
    router.refresh();
  });

  const copiar = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setAviso({ texto: "Enlace copiado", url }); } catch { setAviso({ texto: url }); }
  };

  const nuevaVersion = (r: Revista) => {
    setTitulo(r.titulo); setSlug(r.slug); setSlugTocado(true); setArchivo(null); setError(null); setAviso(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    inputRef.current?.click();
  };

  return (
    <div className={ui.stack}>
      {error && <div className={ui.alert}>{error}</div>}
      {aviso && (
        <div className={`${ui.alert} ${ui.alertOk}`}>
          <span>
            {aviso.texto}
            {aviso.url && <>: <a href={aviso.url} target="_blank" rel="noopener noreferrer" className={s.enlace}>{aviso.url.replace(/^https?:\/\//, "")}</a></>}
          </span>
        </div>
      )}

      <div className={ui.card} ref={formRef}>
        <div className={ui.cardHead}><div className={ui.cardTitle}><FileUp /> Publicar una revista</div></div>
        <div className={ui.cardBody}>
          <div className={s.subir}>
            <div className={ui.stack} style={{ gap: 14 }}>
              <label
                className={`${s.zona} ${arrastrando ? s.zonaOn : ""}`}
                onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
                onDragLeave={() => setArrastrando(false)}
                onDrop={(e) => { e.preventDefault(); setArrastrando(false); elegir(e.dataTransfer.files?.[0]); }}
              >
                <input ref={inputRef} type="file" accept="application/pdf,.pdf" disabled={ocupado}
                  onChange={(e) => elegir(e.target.files?.[0])} />
                <Upload />
                {archivo ? (
                  <div className={s.archivo}><b>{archivo.name}</b><small>{(archivo.size / 1024 / 1024).toFixed(1)} MB</small></div>
                ) : (
                  <><b>Arrastra aquí el PDF de la revista</b><span>o haz clic para elegirlo</span></>
                )}
              </label>
              <div className={ui.grid}>
                <label className={`${ui.field} ${ui.span6}`}>
                  <span className={ui.label}>Título</span>
                  <input className={ui.input} value={titulo} maxLength={120} placeholder="Verano al natural 2027" disabled={ocupado}
                    onChange={(e) => { setTitulo(e.target.value); if (!slugTocado) setSlug(slugDe(e.target.value)); }} />
                </label>
                <label className={`${ui.field} ${ui.span6}`}>
                  <span className={ui.label}>Nombre en la dirección web</span>
                  <input className={ui.input} value={slug} maxLength={40} placeholder="verano2027" disabled={ocupado}
                    style={errSlug ? { borderColor: "var(--danger)" } : undefined}
                    onChange={(e) => { setSlugTocado(true); setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-")); }} />
                  <span className={s.url}>
                    {errSlug ? <span style={{ color: "var(--danger)" }}>{errSlug}</span>
                      : <>Quedará en <b>{dominio}/revistas/{slug || "nombre"}</b>{existe ? " (reemplaza la que ya está publicada)" : ""}</>}
                  </span>
                </label>
              </div>
              <div className={ui.row}>
                <button className={`${ui.btn} ${ui.primary}`} disabled={ocupado || !archivo} onClick={() => publicar()}>
                  <Upload /> {existe ? "Reemplazar revista" : "Publicar revista"}
                </button>
                {archivo && !ocupado && (
                  <button className={`${ui.btn} ${ui.ghost}`} onClick={() => { setArchivo(null); if (inputRef.current) inputRef.current.value = ""; }}>
                    Quitar PDF
                  </button>
                )}
              </div>
              {paso && (
                <div className={s.progreso} aria-live="polite">
                  <div className={s.barra}><div style={{ width: `${paso.pct}%` }} /></div>
                  <div className={s.progTxt}>{paso.texto} No cierres esta página.</div>
                </div>
              )}
            </div>
            <div className={s.prev}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {portada ? <img src={portada} alt="Portada" /> : <span>{archivo ? "Leyendo portada…" : "Portada"}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className={ui.card}>
        <div className={ui.cardHead}>
          <div className={ui.cardTitle}>Publicadas ({revistas.length})</div>
          <button className={`${ui.btn} ${ui.ghost} ${ui.sm}`} onClick={() => router.refresh()} disabled={ocupado}><RefreshCw /> Actualizar</button>
        </div>
        {!revistas.length ? (
          <Empty>Todavía no hay revistas publicadas</Empty>
        ) : (
          <div className={s.lista}>
            {revistas.map((r) => {
              const url = `${sitio}${rutaRevista(r.slug)}/`;
              return (
                <div key={r.slug} className={s.item}>
                  <a href={url} target="_blank" rel="noopener noreferrer" className={`${s.portada} ${r.activo ? "" : s.oculta}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${sitio}${rutaRevista(r.slug)}/${archivoPagina(1, r.version)}`} alt="" loading="lazy" />
                    <span className={s.estado}>{r.activo ? <Badge tono="ok">Publicada</Badge> : <Badge>Oculta</Badge>}</span>
                  </a>
                  <div className={s.cuerpo}>
                    <div className={s.titulo}>{r.titulo}</div>
                    <a href={url} target="_blank" rel="noopener noreferrer" className={s.enlace}>{dominio}/revistas/{r.slug}</a>
                    <div className={s.meta}>{r.paginas} páginas · actualizada {fecha(r.actualizado.slice(0, 10))}</div>
                    <div className={s.botones}>
                      <a className={`${ui.btn} ${ui.sm}`} href={url} target="_blank" rel="noopener noreferrer" title="Ver"><ExternalLink /> Ver</a>
                      <button className={`${ui.btn} ${ui.sm}`} onClick={() => copiar(url)} title="Copiar enlace"><Copy /> Copiar</button>
                      <button className={`${ui.btn} ${ui.ghost} ${ui.sm} ${ui.icon}`} onClick={() => setEditar({ r, titulo: r.titulo })} disabled={ocupado}
                        title="Editar título" aria-label="Editar título"><Pencil /></button>
                      <button className={`${ui.btn} ${ui.ghost} ${ui.sm} ${ui.icon}`} onClick={() => visibilidad(r)} disabled={ocupado}
                        title={r.activo ? "Ocultar de la web" : "Volver a mostrar"} aria-label={r.activo ? "Ocultar" : "Mostrar"}>
                        {r.activo ? <EyeOff /> : <Eye />}
                      </button>
                      <button className={`${ui.btn} ${ui.ghost} ${ui.sm} ${ui.icon}`} onClick={() => nuevaVersion(r)} disabled={ocupado}
                        title="Subir una nueva versión del PDF" aria-label="Nueva versión"><RefreshCw /></button>
                      <button className={`${ui.btn} ${ui.ghost} ${ui.sm} ${ui.icon}`} onClick={() => setBorrarSlug(r)} disabled={ocupado}
                        title="Eliminar" aria-label="Eliminar"><Trash2 /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={!!reemplazar} onClose={() => setReemplazar(null)} title="Reemplazar revista" width={460}
        footer={<>
          <button className={`${ui.btn} ${ui.ghost}`} onClick={() => setReemplazar(null)}>Cancelar</button>
          <button className={`${ui.btn} ${ui.primary}`} onClick={() => publicar(true)}>Sí, reemplazar</button>
        </>}>
        Ya hay una revista en <b>{dominio}/revistas/{reemplazar}</b>. Si continúas, ese enlace mostrará el PDF nuevo (quien ya lo tenga verá la versión nueva).
      </Modal>

      <Modal open={!!editar} onClose={() => setEditar(null)} title="Editar título" width={460}
        footer={<>
          <button className={`${ui.btn} ${ui.ghost}`} onClick={() => setEditar(null)}>Cancelar</button>
          <button className={`${ui.btn} ${ui.primary}`} disabled={pending || !editar?.titulo.trim()} onClick={guardarTitulo}>Guardar</button>
        </>}>
        <label className={ui.field}>
          <span className={ui.label}>Título</span>
          <input className={ui.input} value={editar?.titulo ?? ""} maxLength={120} autoFocus
            onChange={(e) => editar && setEditar({ ...editar, titulo: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && guardarTitulo()} />
        </label>
        <p className={s.url} style={{ marginTop: 10 }}>
          La dirección <b>{dominio}/revistas/{editar?.r.slug}</b> no cambia. Si el nombre de la ruta está mal, elimina la revista y publícala de nuevo.
        </p>
      </Modal>

      <Modal open={!!borrarSlug} onClose={() => setBorrarSlug(null)} title="Eliminar revista" width={460}
        footer={<>
          <button className={`${ui.btn} ${ui.ghost}`} onClick={() => setBorrarSlug(null)}>Cancelar</button>
          <button className={`${ui.btn} ${ui.danger}`} disabled={pending} onClick={() => borrarSlug && eliminar(borrarSlug)}>Eliminar</button>
        </>}>
        Se borrará <b>{borrarSlug?.titulo}</b> de la web y el enlace {dominio}/revistas/{borrarSlug?.slug} dejará de funcionar. No se puede deshacer.
        Si solo quieres que no se vea por un tiempo, usa Ocultar.
      </Modal>
    </div>
  );
}
