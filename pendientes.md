# Pendientes de la revisión del 10/11/2026

Esto quedó fuera de las correcciones de `supabase/migrations/20261110000000_correcciones_revision.sql`
y de los cambios de código del mismo día. Va ordenado por gravedad.

## Por decidir con Hanlo

- **Costos y márgenes visibles para todos los usuarios activos.**
  - `articulo_proveedor.precio_compra`, `cotizacion_items.precio_costo` y `factor` se pueden leer con cualquier sesión activa.
  - El editor los recibe en el navegador (`src/components/cotizacion/datos.ts`).
  - El detalle muestra "Costo · margen (interno)" sin pedir ningún permiso.
  - Si los vendedores no deben verlos: crear un permiso `ver_costos`, quitar el SELECT de esas columnas (o pasarlas por una vista o RPC filtrada) y no enviarlas como props.

## Límites conocidos de lo que se corrigió

- **A3, el precio mínimo en la base, revisa los ítems y no la cabecera.**
  - Un PATCH directo a `cotizaciones` que cambie la moneda (por ejemplo, de USD a PEN) o el T.C. sin reescribir los ítems no vuelve a validar los precios.
  - La pantalla siempre reescribe los ítems con `guardar_cotizacion`, así que esto solo es posible llamando a la API a mano.
  - Corrección: revalidar los ítems en un trigger de `cotizaciones` cuando cambien `moneda`, `tipo_cambio`, `precios_incluyen_igv` o `igv_pct`.
- **Las banderas `hanlo.copiando` y `hanlo.recalculando`** son variables de sesión de la transacción. No se pueden fijar desde la API (PostgREST no expone `set_config`), pero cualquier función nueva que las active debe hacerlo con cuidado.
- **A5: un usuario que ya existía y se vuelve a importar no cambia su estado activo/inactivo**, porque pudo haber sido desactivado a propósito. Si se importó antes de esta corrección y quedó inactivo, hay que activarlo desde Configuración > Usuarios.

## Medio

- **El precio mínimo en la pantalla no considera el IGV.** El editor usa `costoMaximo` sin IGV y el servidor usa `precioMaximo` con IGV cuando `precios_incluyen_igv`. El texto "Precios sin IGV" está fijo en `Editor.tsx`.
- **El límite de venta se calcula distinto en la pantalla.** La pantalla usa `total × tc`; la base usa `greatest(tc, T.C. oficial, 1)`. La pantalla puede ofrecer "Guardar y emitir" y la cotización terminar en "por aprobar".
- **Cotizaciones en USD guardadas sin T.C.** (anteriores a esta corrección): el dashboard, los reportes y el detalle de cliente las cuentan 1 a 1 (`coalesce(tipo_cambio, 1)`). Hay que buscarlas y completarlas.
- **Importaciones no transaccionales.** Un error a mitad del proceso deja guardadas las hojas anteriores. En listas de stock, los colores se borran antes de insertarse. Corrección: usar una RPC transaccional que reciba JSON.
- **Login sin límite de intentos.** Como el login va por el servidor, Supabase limita por la IP del servidor. Corrección: limitar por IP real y por correo.
- **Rendimiento:**
  - el Excel (hasta 45 MB) se parsea dos veces en memoria;
  - los triggers fila por fila (`items_after_change`, `apc_sumar_stock`, `ap_sumar_stock`) generan miles de updates;
  - el editor manda todos los clientes al navegador.
- **Tipos débiles:** no hay tipos generados de Supabase y hay 14 `as unknown as`. Corrección: usar `supabase gen types typescript` y pasar `<Database>` al cliente.

## Bajo

- **Cabecera `x-sin-actividad`.** Quien tiene permiso `importar` puede mandarla desde el navegador en cualquier escritura y no queda registro. Corrección: usar una variable que fije solo el servidor dentro de una RPC.
- **Estados permitidos de más:** `→ reemplazada` sin crear versión (oculta la cotización de los listados) y `borrador → por_aprobar` directo. Corrección: permitir `reemplazada` solo dentro de `nueva_version_cotizacion`.
- **`keepalive()` es ejecutable por `anon`.** La ruta ya la llama con la llave secreta, así que se podría revocar a `anon` y `authenticated`.
- **Bucket `media`.**
  - No restringe tipos de archivo ni tamaño, así que se puede subir HTML o SVG a un bucket público.
  - El permiso de artículos puede tocar logos y el de empresas puede tocar fotos.
  - Corrección: `allowed_mime_types` de imágenes, límite de tamaño y permisos por carpeta.
- **`consultarDocumento`** solo pide sesión: cualquier usuario activo consulta DNI (datos personales) y gasta la cuota de Decolecta.
- **`enable_signup = true`** en `supabase/config.toml`. Hay que desactivarlo también en el proyecto de producción.
- **Errores crudos de Postgres en pantalla** (`ModuloPage.tsx`, `errores.ts` por defecto).
- **Faltan cabeceras de seguridad** en `next.config.ts`: CSP, `frame-ancestors` y `Referrer-Policy`.
- **Aviso de stock no numérico:** "AGOTADO" nunca avisa (`importador-listas.ts`, `n === null && stockTxt`).
- **Stock revisado por línea:** dos líneas del mismo artículo y color no se suman.
- **Doble clic en "Duplicar"** puede crear dos copias (`Acciones.tsx`).
- **`onEmitir` del aviso de stock** navega aunque haya error (`Editor.tsx`).
- **Ediciones simultáneas:** gana la última. Corrección: comparar `updated_at` antes de guardar.
- **Importador:** "1,5" y "1,500" se leen de forma ambigua. Además, `codigoDeNombre` (hash de 7 caracteres) crea artículos nuevos si cambia el nombre y puede tener colisiones.
- **`validez_dias`** negativo o decimal no se valida en la acción.
- **Consultas de más:**
  - el detalle trae todos los perfiles;
  - la impresión consulta dos veces la cotización (usar `cache()`);
  - el editor llama a SUNAT durante el render, con espera de hasta 10 s;
  - hay `includes` O(n²) en `importador-listas.ts`.

## Código muerto, duplicado y otros

- **Código muerto:**
  - `empresas.margen_pct` se consulta, pero `margenPct` queda siempre en 0;
  - la función `total_en_soles()` de la base ya no se usa;
  - el aviso "falta migración" en `configuracion/importar/page.tsx`;
  - el parámetro `nombreArchivo` no se usa en `acciones-importar.ts`;
  - el comentario de `bodySizeLimit` en `next.config.ts`;
  - CSS sin usar: `.logo` (login y shell), `.catImg` y `.thumb`.
- **Duplicado:**
  - `leer` y `leerLista` (`acciones-importar.ts`);
  - extracción de fotos (4 veces) y subida de fotos (2 veces);
  - filtros del listado entre la página y el Excel;
  - `money()` redefinida en `acciones-busqueda.ts`;
  - el helper `todos()` de `datos.ts` y el nuevo `todasLasFilas()` de `src/lib/consultas.ts`.
- **`supabase/seed.sql`** inserta un cliente con DNI, pero la app solo admite RUC.
- **README:** dice que la última migración es `blindaje.sql`, pero después vinieron `roles.sql` y `correcciones_revision.sql`.
- **exceljs 4.4.0** no tiene versiones nuevas desde 2023 (a confirmar).
