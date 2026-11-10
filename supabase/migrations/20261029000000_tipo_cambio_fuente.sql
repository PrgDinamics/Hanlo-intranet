-- Origen de cada tipo de cambio: traído de SUNAT (automático) o registrado a mano
alter table public.tipos_cambio
  add column if not exists fuente text not null default 'manual' check (fuente in ('manual', 'sunat'));

notify pgrst, 'reload schema';
