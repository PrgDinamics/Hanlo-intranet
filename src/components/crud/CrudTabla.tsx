"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Empty } from "@/components/ui/Empty";
import { MODULOS } from "@/lib/modulos";
import { RegistroForm, type Refs } from "./RegistroForm";
import { Celda, esNumerica } from "./Celda";
import ui from "@/components/ui/ui.module.css";

type Row = Record<string, unknown> & { id: string };

export function CrudTabla({
  modKey, rows, refs, consulta, soloLectura,
}: { modKey: string; rows: Row[]; refs: Refs; consulta?: boolean; soloLectura?: boolean }) {
  const mod = MODULOS[modKey];
  const router = useRouter();
  const [editando, setEditando] = useState<Row | null>(null);

  if (!rows.length) return <Empty>No se encontraron {mod.titulo.toLowerCase()}</Empty>;

  return (
    <>
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead>
            <tr>
              {mod.columnas.map((c) => (
                <th key={c.name} className={esNumerica(c) ? ui.num : undefined}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={ui.rowLink}
                onClick={() => (mod.detalle ? router.push(`${mod.ruta}/${r.id}`) : setEditando(r))}
              >
                {mod.columnas.map((c) => (
                  <td key={c.name} className={esNumerica(c) ? ui.num : undefined} style={c.type === "image" ? { width: 52 } : undefined}>
                    <Celda col={c} row={r} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!editando} onClose={() => setEditando(null)} title={soloLectura ? mod.singular.charAt(0).toUpperCase() + mod.singular.slice(1) : `Editar ${mod.singular}`}>
        {editando && (
          <RegistroForm
            key={editando.id}
            modKey={modKey}
            registro={editando}
            refs={refs}
            consulta={consulta}
            soloLectura={soloLectura}
            compact
            onCancel={() => setEditando(null)}
            onSaved={() => { setEditando(null); router.refresh(); }}
            onDeleted={() => { setEditando(null); router.refresh(); }}
          />
        )}
      </Modal>
    </>
  );
}

export function NuevoBoton({ modKey, refs, consulta }: { modKey: string; refs: Refs; consulta?: boolean }) {
  const mod = MODULOS[modKey];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`${ui.btn} ${ui.primary}`} onClick={() => setOpen(true)}>
        <Plus /> Nuevo {mod.singular}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Nuevo ${mod.singular}`}>
        {open && (
          <RegistroForm
            modKey={modKey}
            refs={refs}
            consulta={consulta}
            compact
            onCancel={() => setOpen(false)}
            onSaved={(id) => {
              setOpen(false);
              if (mod.detalle) router.push(`${mod.ruta}/${id}`);
              else router.refresh();
            }}
          />
        )}
      </Modal>
    </>
  );
}
