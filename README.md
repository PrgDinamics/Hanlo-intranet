# Intranet Hanlo · Gestión de Cotizaciones

Next.js 16 (App Router) · React 19 · Supabase (Postgres, Auth, Storage) · CSS Modules · lucide-react

## Módulos

| Ruta | Qué hace |
|---|---|
| `/` | Dashboard: KPIs del mes, cotizaciones por mes, por estado, últimas cotizaciones |
| `Ctrl K` | Búsqueda global desde cualquier pantalla: cotizaciones, clientes, artículos, proveedores y accesos rápidos |
| `/reportes` | Reportes por periodo, agente y empresa: cotizado vs. aceptado, por agente, cliente, artículo y proveedor. Tablas ordenables y exportación a Excel |
| `/configuracion/importar` | Importador de la plantilla Excel con vista previa y validación fila por fila |
| `/cotizaciones` | Listado con búsqueda (cliente, RUC/DNI, número) y filtros por estado, agente y periodo |
| `/cotizaciones/nueva` | Editor: empresa, cliente, agente, moneda + T.C., forma de pago, lugar/fecha, validez, ítems del catálogo eligiendo proveedor y precio, margen interno |
| `/cotizaciones/[id]` | Detalle, cambio de estado, anulación con motivo, nueva versión, duplicar, historial |
| `/imprimir/cotizacion/[id]` | Vista A4 para imprimir o guardar como PDF |
| `/clientes` | Clientes: solo empresas con RUC (11 dígitos), contacto, categoría, récord comercial |
| `/articulos` | Catálogo con detalle, foto (lupa para verla en grande), línea, stock y precios por proveedor |
| `/proveedores` | Proveedores con RUC, contacto, línea de crédito y artículos que proveen |
| `/lineas` | Líneas de artículos |
| `/configuracion/*` | Solo admin: empresas, usuarios, agentes, tipos de cambio, formas de pago |

## Reglas de negocio (viven en la base de datos)

* Correlativo por empresa y serie (`COT-000001`), sin duplicados aunque dos usuarios guarden a la vez.
* Totales calculados por trigger (subtotal, IGV, total), con o sin IGV incluido.
* Estados: borrador → emitida → entregada → aceptada / rechazada / vencida. Anular exige motivo.
* Solo se editan cotizaciones en borrador o emitida. Para cambiar una entregada se crea una **nueva versión** (v2, v3) y la anterior queda como reemplazada.
* Las cotizaciones nunca se borran. Todo cambio de estado queda en el historial con usuario y fecha.
* Precio más alto: cuando un artículo tiene varios proveedores, se cotiza siempre con el precio de venta más alto entre ellos (validado en pantalla y en el servidor). El proveedor elegido solo define el costo y el margen. Para rebajar se usa la columna de descuento, que queda visible en la cotización.
* Los ítems guardan copia de descripción y precio: si cambia el catálogo, las cotizaciones antiguas no cambian.
* RLS: cualquier usuario autenticado lee; vendedores mantienen clientes, artículos, proveedores y cotizaciones; solo admin toca tablas del sistema.

## Puesta en marcha

1. Crear un proyecto en Supabase.
2. En el SQL Editor, pegar y ejecutar **`supabase/instalar_todo.sql`** (todas las migraciones juntas, en orden).
   Equivale a correr uno por uno los archivos de `supabase/migrations/`.
   (Opcional, datos de prueba: `supabase/seed.sql`; no lo corras si vas a cargar datos reales.)
3. En Supabase > Authentication > Sign In / Providers: desactivar "Allow new users to sign up" (los usuarios los crea el admin desde la intranet).
4. Copiar `.env.example` a `.env.local` y completar las llaves.
5. Instalar y crear el primer administrador:

```bash
npm install
node --env-file=.env.local scripts/crear-admin.mjs admin@empresa.com "Contraseña123" "Nombre Apellido"
npm run dev
```

### Si ya estaba instalado

Correr en el SQL Editor solo las migraciones nuevas, en orden. La última es **`20261103000000_blindaje.sql`** (resultado de las pruebas de error y rendimiento). Se puede correr más de una vez sin problema.

Si ya estaba instalado, correr también **`supabase/migrations/20261110000000_correcciones_revision.sql`** (correcciones de la revisión del 10/11/2026; se puede correr más de una vez).

* Usuarios creados por fuera de la intranet nacen como vendedor **inactivo** (antes, con el registro abierto de Supabase, alguien podía crearse una cuenta de administrador).
* Solo los usuarios activos leen datos.
* Totales, número de cotización e IGV solo los calcula la base; el límite de venta usa el tipo de cambio oficial.
* Políticas de seguridad escritas para evaluarse una vez por consulta (listas, dashboard y editor mucho más rápidos con miles de registros).
* Tipo de cambio entre 1 y 10, ítems con descripción, fotos y logos solo con permiso de artículos.

## Roles y permisos

En **Configuración > Roles y permisos** el Administrador crea roles y marca qué puede hacer cada uno. Vienen tres:

| Rol | Para qué |
|---|---|
| **Administrador** (fijo) | Gerencia: todo, incluidos reportes, usuarios, roles y agentes. No se puede editar ni borrar. |
| **Vendedor** | Cotiza y ve solo lo suyo. |
| **Coordinador** | Ve todas las cotizaciones y aprueba, mantiene catálogo y precios, sube Excel, tipo de cambio y formas de pago. Sin reportes. |

Permisos disponibles: ver todas las cotizaciones, aprobar, clientes, artículos, importar Excel, tipo de cambio, formas de pago, empresas, reportes y registro de actividad. Crear clientes o artículos también se puede dar desde el agente comercial (vale cualquiera de los dos), y el límite de venta sigue siempre en el agente. Usuarios, roles y agentes son exclusivos del Administrador; un rol que no es Administrador tampoco puede cargar las hojas Usuarios y Agentes de la carga inicial.

Migración: `20261104000000_roles.sql` (los usuarios existentes quedan como Administrador o Vendedor según tenían).

## Pruebas

Antes de entregar se probaron 135 casos de error (accesos sin permiso por la pantalla y directo a la API, datos inválidos, Excel dañados, SUNAT caído o lento, sesión vencida, doble clic, rutas inexistentes) y el rendimiento con el volumen de un año de uso (5,000 artículos, 2,000 clientes, 6,000 cotizaciones, 45,000 ítems, 50,000 registros de actividad) y con 10 a 25 usuarios a la vez.

## Despliegue y dominio

* Vercel: importar el repo y cargar las mismas variables de entorno. Mientras no haya dominio queda en `hanlo-intranet.vercel.app`.
* Cuando tengan dominio: en Vercel > Domains agregar `intranet.sudominio.com` y crear el registro CNAME que indique Vercel. No hay que tocar código.
* En Supabase > Authentication > URL Configuration poner esa URL como Site URL.

## Evitar que Supabase se pause (plan gratis)

El plan gratis de Supabase pausa el proyecto tras 7 días sin uso. La ruta `/api/keepalive` hace una consulta real a la base y a Storage (y guarda el T.C. SUNAT del día). La llama una vez al día **GitHub Actions** (`.github/workflows/keepalive.yml`), gratis en un repositorio privado.

1. En Vercel > Settings > Environment Variables agregar `CRON_SECRET` con un texto largo al azar y volver a desplegar.
2. En GitHub > el repositorio > Settings > Secrets and variables > Actions crear dos secretos:
   * `CRON_SECRET`: el mismo valor que en Vercel.
   * `INTRANET_URL`: `https://intranet.hanloinnova.com` (sin / al final).
3. En GitHub > Actions > "Keepalive diario" > **Run workflow** para probarlo. Debe terminar en verde con `"ok":true`.

Respaldo opcional desde cPanel > Cron Jobs (una vez al día):

```bash
curl -s -H "Authorization: Bearer EL_CRON_SECRET" https://intranet.hanloinnova.com/api/keepalive
```

## Agentes de venta, permisos y aprobaciones

* Cada agente (Configuración > Agentes) tiene: ID vendedor, **Crea cliente**, **Crea artículo** y **Límite S/ de venta**.
* El usuario del vendedor se vincula a su agente en Configuración > Usuarios; de ahí toma sus permisos.
* Sin "Crea cliente" ve los clientes en solo lectura. Sin "Crea artículo" ve artículos, precios, proveedores y líneas en solo lectura. Se valida también en la base de datos (RLS).
* Si una cotización supera el límite del vendedor (en soles), al emitirla queda **Por aprobar**. Un administrador la aprueba (pasa a Emitida) o la devuelve a borrador. El dashboard avisa cuántas hay pendientes.
* Los administradores no tienen límite.

## Listas de stock de proveedores

Configuración > Importar desde Excel > **Lista de stock de proveedor**:

* Se elige el proveedor (o se crea ahí mismo) y se sube su lista tal como la envía ("STOCK CLIENTES", AdminPlus, etc.).
* Formato "Promos" (CÓDIGO, ARTÍCULO, CÓDIGO SISTEMA, COLOR, STOCK, A PARTIR DE 500 / 50 / DE 1 A 49): precios unitarios por tramo; también lee las hojas REMATES y Ofertas.
* **IGV de la lista:** antes de importar siempre se pregunta si los precios de la lista incluyen IGV (no viene nada marcado). Como pista se muestra lo que dice el archivo ("LOS PRECIOS NO INCLUYEN IGV", "INCLUIDO IGV") o lo que se eligió la última vez para ese proveedor. Si incluyen IGV, se guardan sin IGV (÷ 1.18), porque el IGV se suma en la cotización.
* Formato "Tienda Publicitaria" (DESCRIPCION x PRODUCTO, DETALLE x CAJA, PU 500 A 1000, PU 50 A 499, 1 A 49): no trae códigos, así que se genera uno estable a partir del nombre (`TP-XXXXXXX`). Sus precios son unitarios. Si un producto aparece en dos hojas se carga una sola vez.
* Cada hoja es una **línea**. De cada producto se toma: código, nombre, empaque ("1000 UNID X CAJA"), descripción, foto incrustada, **stock por color** y precios **muestra / por ciento / por millar** (con el mínimo de unidades del encabezado).
* Artículos nuevos se crean; los existentes solo actualizan precio y stock de ese proveedor (no se pisa la descripción que hayas editado).
* Opción: lo que el proveedor ya no lista queda con stock 0.
* Al cotizar, el precio se elige por cantidad (muestra, ciento o millar) y siempre el **más alto entre proveedores**. Se elige el color y se avisa si no alcanza el stock.
* Empresa > **Margen %** (opcional): se suma al precio del proveedor al cotizar. En 0, se cotiza el precio del proveedor tal cual.

## Importación

Configuración > Importar desde Excel acepta:

* **El formato de la empresa** ("Información para cargar a la Base de Datos"): hojas Artículos (con foto pegada en la celda, hasta 4 proveedores con RUC y precio, STOCK), Proveedores, Clientes y AgentesVenta. Se descarga vacío desde la misma pantalla.
* La plantilla anterior de carga inicial (Empresa, Usuarios, Formas de pago, etc.).

El Excel se sube a un bucket privado de Storage (`importaciones`) y se analiza antes de guardar: muestra nuevos, actualizados y errores por fila.

**Archivos pesados:** si el Excel pesa más de 8 MB, el navegador reduce las fotos pegadas (máx. 1000 px, JPEG) antes de subirlo, sin tocar las celdas. Una lista de 314 MB queda en unos 13 MB. El límite después de optimizar es 45 MB; si aun así se pasa, dividir el archivo por hojas.

## Consultas SUNAT / RENIEC (opcional)

Con `DECOLECTA_TOKEN` (cuenta en https://decolecta.com) se activan:

* Botón **Buscar** junto al RUC/DNI en clientes, proveedores y empresas: completa razón social o nombre y dirección, y avisa si el RUC no está ACTIVO o HABIDO.
* Botón **Traer T.C. SUNAT de hoy** en Tipos de cambio.
* Al abrir una cotización nueva, si no hay tipo de cambio del día, se trae solo.

Sin el token todo funciona igual y esos botones no aparecen.

## Interactividad en el editor

* Alta rápida de cliente sin salir de la cotización (con búsqueda RUC/DNI).
* "Último a este cliente": muestra el precio con que se le cotizó cada artículo la última vez.
* Precio más alto entre proveedores, validado en pantalla y en el servidor.

## Pendiente para siguientes fases

* Envío de la cotización por correo (Resend) y por WhatsApp.
