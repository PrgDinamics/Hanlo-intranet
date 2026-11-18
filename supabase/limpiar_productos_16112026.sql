-- =====================================================================
-- Borrar productos para volver a cargarlos bien (16/11/2026)
-- Correr en Supabase > SQL Editor, por partes, en este orden.
--
-- No hace falta borrar las cotizaciones: si se borran los artículos, las cotizaciones
-- quedan con sus ítems (descripción, cantidad, precio) como "ítem libre", sin el artículo.
-- Si las cotizaciones de ahora son solo de prueba, borra también las cotizaciones (paso 2).
-- =====================================================================

-- PASO 1. Ver cuánto hay antes de borrar
select
  (select count(*) from public.cotizaciones)          as cotizaciones,
  (select count(*) from public.articulos)             as articulos,
  (select count(*) from public.articulo_proveedor)    as precios_por_proveedor,
  (select count(*) from public.proveedores)           as proveedores,
  (select count(*) from public.lineas)                as lineas;


-- PASO 2 (OPCIONAL). Borrar TODAS las cotizaciones (solo si son de prueba)
-- La numeración vuelve a empezar desde "Último número usado" de Configuración > Empresas.
begin;
alter table public.cotizacion_items disable trigger t_items_guard;   -- deja borrar también las aceptadas, anuladas, etc.
alter table public.cotizacion_items disable trigger t_items_after_change;
delete from public.cotizaciones;
alter table public.cotizacion_items enable trigger t_items_guard;
alter table public.cotizacion_items enable trigger t_items_after_change;
commit;


-- PASO 3. Borrar artículos, sus precios por proveedor, su stock por color y las líneas
begin;
alter table public.cotizacion_items disable trigger t_items_guard;   -- las cotizaciones que queden pasan a "ítem libre"
alter table public.cotizacion_items disable trigger t_items_after_change;  -- precios y totales no cambian: no hace falta recalcular
-- Ítems antiguos sin descripción: toman la del artículo (si no, no se pueden soltar del artículo)
update public.cotizacion_items i set descripcion = coalesce(nullif(trim(a.descripcion), ''), a.codigo, '(sin descripción)')
  from public.articulos a
 where a.id = i.articulo_id and trim(coalesce(i.descripcion, '')) = '';
delete from public.articulos;        -- borra también precios por proveedor y stock por color
delete from public.lineas;
alter table public.cotizacion_items enable trigger t_items_guard;
alter table public.cotizacion_items enable trigger t_items_after_change;
commit;


-- PASO 4 (OPCIONAL). Borrar también los proveedores
-- Solo si los vas a volver a crear. Si no, déjalos: al subir su lista se usan los mismos.
-- begin;
-- alter table public.cotizacion_items disable trigger t_items_guard;
-- delete from public.proveedores;
-- alter table public.cotizacion_items enable trigger t_items_guard;
-- commit;


-- PASO 5. Revisar que quedó en cero
select
  (select count(*) from public.cotizaciones)          as cotizaciones,
  (select count(*) from public.articulos)             as articulos,
  (select count(*) from public.articulo_proveedor)    as precios_por_proveedor,
  (select count(*) from public.proveedores)           as proveedores,
  (select count(*) from public.lineas)                as lineas;
