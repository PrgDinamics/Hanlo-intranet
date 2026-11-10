-- Datos de ejemplo para desarrollo (no correr en producción si ya hay datos reales)

insert into public.empresas (razon_social, nombre_comercial, ruc, direccion, telefono, email, serie, pie_cotizacion)
values ('HANLO INNOVA S.A.C.', 'Hanlo', '20600000001', 'Lima, Perú', '(01) 000 0000', 'ventas@hanlo.pe', 'COT',
        'Precios sujetos a stock. Cuenta BCP Soles: 000-0000000-0-00. Cuenta BCP Dólares: 000-0000000-1-00.');

insert into public.agentes (nombre, num_doc, email, telefono, crea_cliente, crea_articulo, limite_venta) values
  ('Ventas Oficina', '40000001', 'ventas@hanlo.pe', '999 000 001', true, true, null),
  ('Carlos Ramírez', '40000002', 'carlos@hanlo.pe', '999 000 002', true, false, 3000);

insert into public.formas_pago (nombre, dias_credito) values
  ('Contado', 0), ('Adelanto 50% / Saldo contra entrega', 0),
  ('Crédito 15 días', 15), ('Crédito 30 días', 30), ('Crédito 60 días', 60)
on conflict (nombre) do nothing;

insert into public.tipos_cambio (fecha, compra, venta) values
  (current_date, 3.745, 3.752),
  (current_date - 1, 3.741, 3.749);

insert into public.lineas (nombre, descripcion) values
  ('Útiles de oficina', 'Papelería y artículos de escritorio'),
  ('Tecnología', 'Equipos y accesorios de cómputo'),
  ('Limpieza', 'Productos de limpieza e higiene'),
  ('Mobiliario', 'Muebles de oficina');

insert into public.proveedores (ruc, razon_social, direccion, telefono, contacto_nombre, linea_credito) values
  ('20100000011', 'DISTRIBUIDORA ANDINA S.A.C.', 'Av. Argentina 123, Lima', '01 111 1111', 'María Torres', 20000),
  ('20100000022', 'TECNOIMPORT PERU S.A.', 'Av. Wilson 456, Lima', '01 222 2222', 'Luis Paredes', 50000),
  ('20100000033', 'LIMPIEZA TOTAL E.I.R.L.', 'Jr. Ica 789, Lima', '01 333 3333', 'Ana Díaz', 8000);

insert into public.articulos (codigo, descripcion, detalle, unidad, linea_id, stock_ref)
select v.codigo, v.descripcion, v.detalle, v.unidad, l.id, v.stock
from (values
  ('PAP-A4-75', 'Papel bond A4 75 g x 500 hojas', 'Blancura 96%, ideal para impresión láser e inyección', 'PQT', 'Útiles de oficina', 120),
  ('LAP-AZ-12', 'Lapicero azul punta fina x 12', 'Tinta de secado rápido', 'CJA', 'Útiles de oficina', 40),
  ('MON-24-FHD', 'Monitor 24" Full HD IPS', 'Puertos HDMI y DisplayPort, 75 Hz', 'UND', 'Tecnología', 8),
  ('TEC-USB-ES', 'Teclado USB en español', 'Teclado de membrana, resistente a salpicaduras', 'UND', 'Tecnología', 25),
  ('DET-GL-5L', 'Detergente industrial galón 5 L', 'Biodegradable', 'GLN', 'Limpieza', 30),
  ('SIL-ERG-01', 'Silla ergonómica con apoyo lumbar', 'Malla transpirable, regulable en altura', 'UND', 'Mobiliario', 6)
) as v(codigo, descripcion, detalle, unidad, linea, stock)
join public.lineas l on l.nombre = v.linea;

insert into public.articulo_proveedor (articulo_id, proveedor_id, precio_compra, precio_venta, moneda, preferido)
select a.id, p.id, v.compra, v.venta, v.moneda, v.pref
from (values
  ('PAP-A4-75', '20100000011', 16.50, 21.90, 'PEN', true),
  ('PAP-A4-75', '20100000022', 17.20, 22.50, 'PEN', false),
  ('LAP-AZ-12', '20100000011', 8.00, 12.00, 'PEN', true),
  ('MON-24-FHD', '20100000022', 95.00, 129.00, 'USD', true),
  ('TEC-USB-ES', '20100000022', 18.00, 29.90, 'PEN', true),
  ('TEC-USB-ES', '20100000011', 19.50, 31.00, 'PEN', false),
  ('DET-GL-5L', '20100000033', 22.00, 34.00, 'PEN', true),
  ('SIL-ERG-01', '20100000011', 310.00, 459.00, 'PEN', true)
) as v(codigo, ruc, compra, venta, moneda, pref)
join public.articulos a on a.codigo = v.codigo
join public.proveedores p on p.ruc = v.ruc;

insert into public.clientes (tipo_persona, tipo_doc, num_doc, nombre, direccion, telefono, email, contacto_nombre, contacto_cargo, categoria)
values
  ('juridica', 'RUC', '20500000101', 'CONSTRUCTORA LOS ANDES S.A.C.', 'Av. Javier Prado 1000, San Isidro', '01 444 4444', 'compras@losandes.pe', 'Jorge Silva', 'Jefe de Compras', 'regular'),
  ('juridica', 'RUC', '20500000202', 'COLEGIO SAN MARCOS S.A.C.', 'Av. Próceres 200, SJL', '01 555 5555', 'admin@sanmarcos.edu.pe', 'Rosa Medina', 'Administradora', 'potencial'),
  ('natural', 'DNI', '45678912', 'Pedro Gutiérrez Rojas', 'Calle Las Flores 12, Lima', '987 654 321', 'pedro@gmail.com', null, null, 'potencial');
