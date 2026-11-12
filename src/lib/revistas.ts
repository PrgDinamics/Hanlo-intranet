/**
 * Revistas virtuales (catálogos de campaña) publicadas en la web de Hanlo.
 *
 * Todo vive en el cPanel de hanloinnova.com, en public_html/revistas:
 *   revistas/<nombre>/index.html   la revista: portada para WhatsApp + visor (CSS y JS incluidos)
 *   revistas/<nombre>/p01-<v>.jpg  una imagen por página (v = versión, para que no quede en caché)
 *   revistas/<nombre>/.htaccess    caché de las imágenes
 *   revistas/index.json            lista de revistas (la usa la intranet y la puede leer la web
 *                                  para mostrar un listado en hanloinnova.com/revistas/)
 * hanloinnova.com/revistas/<nombre> abre la carpeta directamente: no hace falta tocar el .htaccess.
 * Ver la revista no usa la intranet, Vercel ni Supabase.
 *
 * Solo funciones puras: se usa en el servidor y en el navegador.
 */

export type Revista = {
  slug: string;
  titulo: string;
  paginas: number;
  /** Tamaño de las imágenes (px), para dar la proporción de la página */
  ancho: number;
  alto: number;
  version: string;
  activo: boolean;
  creado: string;
  actualizado: string;
};

export type IndiceRevistas = { revistas: Revista[] };

/** Carpeta de las revistas en el cPanel (relativa a la carpeta del usuario) */
export const CARPETA_REVISTAS = "public_html/revistas";
export const INDICE_REVISTAS = "index.json";
export const carpetaRevista = (slug: string) => `${CARPETA_REVISTAS}/${slug}`;
/** Ruta pública: /revistas/verano27 */
export const rutaRevista = (slug: string) => `/revistas/${slug}`;
export const MAX_PAGINAS = 120;

/** Nombres que no se pueden usar porque son páginas o carpetas del sitio o del hosting */
const RESERVADOS = new Set([
  "productos", "productosweb", "intranet", "admin", "administrador", "cpanel", "webmail", "whm",
  "cgi-bin", "well-known", "wp-admin", "wp-content", "wp-includes", "assets", "static", "img", "images",
  "css", "js", "fonts", "index", "home", "inicio", "api", "mail", "ftp", "www", "_next", "favicon",
]);

/** "Verano al Natural 2027" → "verano-al-natural-2027" */
export function slugDe(texto: string) {
  return texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** null si el nombre sirve; si no, el motivo */
export function validarSlug(slug: string): string | null {
  if (!slug) return "Escribe el nombre que irá en la dirección web";
  if (slug.length < 3) return "El nombre debe tener al menos 3 letras";
  if (slug.length > 40) return "El nombre puede tener hasta 40 letras";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return "Usa solo letras minúsculas, números y guiones (sin tildes ni espacios)";
  if (RESERVADOS.has(slug)) return `"${slug}" ya lo usa la web o el hosting. Elige otro nombre`;
  return null;
}

/** Nombre de la imagen de una página: p01-<versión>.jpg */
export const archivoPagina = (n: number, version: string) => `p${String(n).padStart(2, "0")}-${version}.jpg`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Página de la revista: etiquetas para la vista previa de WhatsApp/Facebook + el visor */
export function htmlRevista(r: Revista, sitio: string) {
  const url = `${sitio}${rutaRevista(r.slug)}/`;
  const portada = `${sitio}${rutaRevista(r.slug)}/${archivoPagina(1, r.version)}`;
  const datos = JSON.stringify({
    titulo: r.titulo,
    paginas: Array.from({ length: r.paginas }, (_, i) => archivoPagina(i + 1, r.version)),
    base: `${rutaRevista(r.slug)}/`,
    ancho: r.ancho,
    alto: r.alto,
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(r.titulo)} | Hanlo Innova</title>
<meta name="description" content="Revista virtual ${esc(r.titulo)} de Hanlo Innova">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(r.titulo)} | Hanlo Innova">
<meta property="og:description" content="Revista virtual de Hanlo Innova. ${esc(String(r.paginas))} páginas.">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(portada)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#111111">
<link rel="preload" as="image" href="${rutaRevista(r.slug)}/${archivoPagina(1, r.version)}">
<style>
${VISOR_CSS}</style>
</head>
<body>
<noscript><p style="padding:24px;font-family:sans-serif">Para ver la revista activa JavaScript en tu navegador.</p></noscript>
<script>window.REVISTA = ${datos};</script>
<script>
${VISOR_JS}</script>
</body>
</html>
`;
}

/** Lo que se ve cuando una revista está oculta */
export function htmlNoDisponible(titulo: string, sitio: string) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(titulo)} | Hanlo Innova</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#eee;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
  h1{font-size:20px;margin:0 0 8px} p{color:#aaa;margin:0 0 20px;font-size:15px}
  a{display:inline-block;padding:11px 20px;border-radius:8px;background:#f5c518;color:#111;text-decoration:none;font-weight:600}
</style>
</head>
<body><div><h1>Esta revista ya no está disponible</h1><p>Mira nuestros productos en la web.</p><a href="${esc(sitio)}">Ir a Hanlo Innova</a></div></body>
</html>
`;
}

/** .htaccess de public_html/revistas: que no se pueda listar la carpeta */
export const HTACCESS_CARPETA = `Options -Indexes
`;

/** .htaccess de la carpeta de cada revista: imágenes en caché un año (cambian de nombre en cada
 *  versión), la página siempre fresca y sin listar la carpeta */
export const HTACCESS_REVISTA = `Options -Indexes
DirectoryIndex index.html
<IfModule mod_headers.c>
  <FilesMatch "\\.(jpg)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "\\.(html)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
`;

/** Estilos del visor (van dentro de la página de cada revista) */
export const VISOR_CSS = `*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#141414;color:#f2f2f2;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-tap-highlight-color:transparent}
body{overflow:hidden}
.rv{position:fixed;inset:0;display:flex;flex-direction:column}
.rv-top{flex:none;display:flex;align-items:center;gap:12px;padding:10px 16px;padding-top:max(10px,env(safe-area-inset-top));background:#0c0c0c;border-bottom:1px solid #262626}
.rv-logo{display:flex;align-items:center;gap:8px;color:#fff;text-decoration:none;font-weight:700;letter-spacing:.02em;font-size:15px;white-space:nowrap}
.rv-logo b{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:6px;background:#f5c518;color:#111;font-size:14px}
.rv-titulo{flex:1;min-width:0;font-size:14px;color:#bdbdbd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rv-btn{flex:none;display:inline-grid;place-items:center;height:36px;min-width:36px;padding:0 10px;border-radius:8px;border:1px solid #333;background:#1d1d1d;color:#eee;font:inherit;font-size:13px;cursor:pointer}
.rv-btn:hover{background:#2a2a2a}
.rv-btn svg{width:18px;height:18px}
.rv-esc{flex:1;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;padding:18px 64px;touch-action:pan-y;user-select:none}
.rv-libro{position:relative;display:flex;box-shadow:0 18px 50px rgba(0,0,0,.55);transition:transform .45s cubic-bezier(.2,.7,.2,1),opacity .45s}
.rv-libro.sale-izq{transform:translateX(-36px);opacity:0}
.rv-libro.sale-der{transform:translateX(36px);opacity:0}
.rv-libro.sin-anim{transition:none}
.rv-pag{position:relative;background:#fff;overflow:hidden}
.rv-pag img{display:block;width:100%;height:100%;object-fit:contain;-webkit-user-drag:none}
.rv-pag.izq::after{content:"";position:absolute;inset:0 0 0 auto;width:26px;background:linear-gradient(90deg,transparent,rgba(0,0,0,.14))}
.rv-pag.der::after{content:"";position:absolute;inset:0 auto 0 0;width:26px;background:linear-gradient(270deg,transparent,rgba(0,0,0,.14))}
.rv-pag.cargando{background:#2a2a2a linear-gradient(100deg,#2a2a2a 30%,#353535 50%,#2a2a2a 70%) 0 0/300% 100%;animation:rv-brillo 1.2s infinite}
@keyframes rv-brillo{to{background-position:-100% 0}}
.rv-flecha{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;border:1px solid #3a3a3a;background:rgba(20,20,20,.8);color:#fff;display:grid;place-items:center;cursor:pointer;z-index:2}
.rv-flecha:hover{background:#2a2a2a}
.rv-flecha:disabled{opacity:.25;cursor:default}
.rv-flecha svg{width:22px;height:22px}
.rv-flecha.ant{left:12px}.rv-flecha.sig{right:12px}
.rv-pie{flex:none;display:flex;align-items:center;gap:14px;padding:10px 16px;padding-bottom:max(10px,env(safe-area-inset-bottom));background:#0c0c0c;border-top:1px solid #262626}
.rv-cont{font-size:13px;color:#bdbdbd;min-width:64px;text-align:center;font-variant-numeric:tabular-nums}
.rv-barra{flex:1;accent-color:#f5c518;height:20px}
.rv-zoom{position:fixed;inset:0;z-index:10;background:#0b0b0b;overflow:auto;-webkit-overflow-scrolling:touch;display:none}
.rv-zoom.abierto{display:block}
.rv-zoom img{display:block;width:100%;max-width:1400px;margin:0 auto;background:#fff}
.rv-zoom .rv-btn{position:fixed;top:max(12px,env(safe-area-inset-top));right:12px;z-index:11;background:rgba(20,20,20,.9)}
.rv-ayuda{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);padding:7px 14px;border-radius:99px;background:rgba(0,0,0,.7);font-size:12.5px;color:#ddd;pointer-events:none;transition:opacity .6s}
@media (max-width:700px){
  .rv-esc{padding:10px 8px}
  .rv-flecha{display:none}
  .rv-logo span{display:none}
}
`;

/** Visor: una página en celular, dos (como revista abierta) en pantallas anchas */
export const VISOR_JS = `(function(){
"use strict";
var R=window.REVISTA;if(!R||!R.paginas||!R.paginas.length)return;
var N=R.paginas.length,ratio=(R.alto||1414)/(R.ancho||1000);
function el(t,c,h){var e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e}
var I={ant:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',sig:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>',zoom:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/></svg>',full:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',cerrar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',comp:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>'};
var raiz=el("div","rv");
var top=el("div","rv-top");
var logo=el("a","rv-logo","<b>H</b><span>HANLO INNOVA</span>");logo.href="/";
var tit=el("div","rv-titulo");tit.textContent=R.titulo;
var bComp=el("button","rv-btn",I.comp);bComp.title="Compartir";bComp.setAttribute("aria-label","Compartir");
var bZoom=el("button","rv-btn",I.zoom);bZoom.title="Ampliar página";bZoom.setAttribute("aria-label","Ampliar página");
var bFull=el("button","rv-btn",I.full);bFull.title="Pantalla completa";bFull.setAttribute("aria-label","Pantalla completa");
top.append(logo,tit,bComp,bZoom);if(document.documentElement.requestFullscreen)top.append(bFull);
var esc=el("div","rv-esc");var libro=el("div","rv-libro");
var fAnt=el("button","rv-flecha ant",I.ant);fAnt.setAttribute("aria-label","Página anterior");
var fSig=el("button","rv-flecha sig",I.sig);fSig.setAttribute("aria-label","Página siguiente");
var ayuda=el("div","rv-ayuda",window.matchMedia&&matchMedia("(pointer:fine)").matches?"Usa la rueda del mouse o las flechas para pasar las páginas":"Desliza para pasar las páginas");
esc.append(libro,fAnt,fSig,ayuda);
var pie=el("div","rv-pie");var cont=el("div","rv-cont");
var barra=el("input","rv-barra");barra.type="range";barra.min=1;barra.max=N;barra.value=1;barra.setAttribute("aria-label","Ir a la página");
pie.append(cont,barra);
var zoom=el("div","rv-zoom");var zImg=el("img");zImg.alt="";var zCerrar=el("button","rv-btn",I.cerrar);zCerrar.setAttribute("aria-label","Cerrar");
zoom.append(zCerrar,zImg);
raiz.append(top,esc,pie,zoom);document.body.append(raiz);

var cache={};function src(i){return R.base+R.paginas[i]}
function precargar(i){if(i<0||i>=N||cache[i])return;var im=new Image();im.decoding="async";im.src=src(i);cache[i]=im}
function doble(){return esc.clientWidth>=900&&esc.clientWidth>esc.clientHeight*1.15}
// Pliegos: portada sola, luego de dos en dos (2-3, 4-5...), la contraportada sola si queda impar
function pliegos(){var p=[];if(!doble()){for(var i=0;i<N;i++)p.push([i]);return p}p.push([0]);for(var j=1;j<N;j+=2)p.push(j+1<N?[j,j+1]:[j]);return p}
var P=pliegos(),actual=0;
function pliegoDe(pag){for(var k=0;k<P.length;k++)if(P[k].indexOf(pag)>=0)return k;return 0}
function medir(cant){var w=esc.clientWidth-(window.innerWidth<=700?16:128),h=esc.clientHeight-(window.innerWidth<=700?20:36);var pw=Math.min(w/cant,h/ratio);return{w:Math.floor(pw),h:Math.floor(pw*ratio)}}
function pintar(dir){var pl=P[actual],m=medir(P.length&&doble()?2:1);
  libro.innerHTML="";
  pl.forEach(function(i,k){var d=el("div","rv-pag cargando"+(pl.length===2?(k===0?" izq":" der"):""));d.style.width=m.w+"px";d.style.height=m.h+"px";
    var im=el("img");im.alt="Página "+(i+1);im.draggable=false;im.decoding="async";im.onload=function(){d.classList.remove("cargando")};im.src=src(i);d.append(im);libro.append(d)});
  if(dir){libro.classList.add("sin-anim");libro.classList.add(dir>0?"sale-der":"sale-izq");void libro.offsetWidth;libro.classList.remove("sin-anim");libro.classList.remove("sale-der","sale-izq")}
  var a=pl[0]+1,b=pl[pl.length-1]+1;cont.textContent=(a===b?a:a+"-"+b)+" / "+N;barra.value=a;
  fAnt.disabled=actual===0;fSig.disabled=actual===P.length-1;
  for(var x=1;x<=3;x++){var s=P[actual+x],t=P[actual-x];if(s)s.forEach(precargar);if(t&&x<2)t.forEach(precargar)}
  try{history.replaceState(null,"",a>1?"#p"+a:location.pathname+location.search)}catch(e){}}
function ir(k,dir){k=Math.max(0,Math.min(P.length-1,k));if(k===actual&&dir)return;actual=k;pintar(dir);ocultarAyuda()}
function sig(){ir(actual+1,1)}function ant(){ir(actual-1,-1)}
fSig.onclick=sig;fAnt.onclick=ant;
barra.oninput=function(){ir(pliegoDe(Number(barra.value)-1),0)};
document.addEventListener("keydown",function(e){if(zoom.classList.contains("abierto")){if(e.key==="Escape")cerrarZoom();return}
  if(e.key==="ArrowRight"||e.key==="PageDown"||e.key===" "){e.preventDefault();sig()}else if(e.key==="ArrowLeft"||e.key==="PageUp"){e.preventDefault();ant()}else if(e.key==="Home")ir(0,-1);else if(e.key==="End")ir(P.length-1,1)});
// Deslizar con el dedo o tocar el borde izquierdo/derecho
var x0=null,y0=0,t0=0;
esc.addEventListener("pointerdown",function(e){if(e.target.closest("button"))return;x0=e.clientX;y0=e.clientY;t0=Date.now()});
// Un toque/clic en el borde pasa de página (con una pequeña espera para distinguirlo del doble toque);
// doble toque o doble clic amplía la página donde se tocó
var tTap=null,uTap=0;
esc.addEventListener("pointerup",function(e){if(x0===null)return;var dx=e.clientX-x0,dy=e.clientY-y0;x0=null;
  if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)){dx<0?sig():ant();return}
  if(Math.abs(dx)<8&&Math.abs(dy)<8&&Date.now()-t0<400){
    var pg=e.target.closest(".rv-pag"),idx=pg?Array.prototype.indexOf.call(libro.children,pg):0,ahora=Date.now();
    if(tTap&&ahora-uTap<300){clearTimeout(tTap);tTap=null;abrirZoom(idx);return}
    uTap=ahora;var r=esc.getBoundingClientRect();var f=(e.clientX-r.left)/r.width;
    tTap=setTimeout(function(){tTap=null;if(f<0.3)ant();else if(f>0.7)sig()},280)}});
// Rueda del mouse o del touchpad: hacia abajo pasa de página, hacia arriba regresa.
// Mientras sigan llegando eventos del mismo gesto (inercia del touchpad) no se pasa otra página.
var acum=0,espera=0,ultimo=0;
esc.addEventListener("wheel",function(e){if(e.ctrlKey)return;e.preventDefault();var d=Math.abs(e.deltaY)>=Math.abs(e.deltaX)?e.deltaY:e.deltaX;
  if(e.deltaMode===1)d*=33;var ahora=Date.now();if(ahora-ultimo>200)acum=0;ultimo=ahora;
  if(ahora<espera){espera=Math.max(espera,ahora+220);return}acum+=d;
  if(Math.abs(acum)>=60){acum>0?sig():ant();acum=0;espera=ahora+550}},{passive:false});
function abrirZoom(k){var pl=P[actual];zImg.src=src(pl[Math.min(k||0,pl.length-1)]);zoom.classList.add("abierto");zoom.scrollTop=0}
function cerrarZoom(){zoom.classList.remove("abierto")}
bZoom.onclick=function(){abrirZoom(0)};zCerrar.onclick=cerrarZoom;
bFull.onclick=function(){if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen().catch(function(){})};
bComp.onclick=function(){var u=location.origin+location.pathname;if(navigator.share){navigator.share({title:R.titulo,url:u}).catch(function(){})}else{window.open("https://wa.me/?text="+encodeURIComponent(R.titulo+" "+u),"_blank","noopener")}};
var oculta=false;function ocultarAyuda(){if(oculta)return;oculta=true;ayuda.style.opacity="0"}
setTimeout(ocultarAyuda,4500);
var rt;window.addEventListener("resize",function(){clearTimeout(rt);rt=setTimeout(function(){var pag=P[actual][0];P=pliegos();actual=pliegoDe(pag);pintar(0)},120)});
function desdeHash(){var h=/^#p(\\d+)$/.exec(location.hash);return h?pliegoDe(Math.min(N,Math.max(1,+h[1]))-1):0}
window.addEventListener("hashchange",function(){var k=desdeHash();if(k!==actual){actual=k;pintar(0)}});
P=pliegos();actual=desdeHash();pintar(0);
})();
`;
