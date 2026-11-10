-- Cada proveedor recuerda si sus listas de stock traen los precios con IGV o sin IGV.
-- null = todavía no se definió (se pregunta en la primera importación).
alter table public.proveedores
  add column if not exists precios_incluyen_igv boolean;

notify pgrst, 'reload schema';
