"use client";

import { PackageX, Send } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import type { Faltante } from "@/lib/acciones-cotizaciones";
import { num } from "@/lib/format";
import ui from "@/components/ui/ui.module.css";

/** Confirmación al emitir cuando las listas de proveedores muestran menos stock del pedido */
export function AvisoStock({
  faltantes, pending, onEmitir, onCancelar, textoCancelar = "No emitir",
}: {
  faltantes: Faltante[] | null;
  pending: boolean;
  onEmitir: () => void;
  onCancelar: () => void;
  textoCancelar?: string;
}) {
  return (
    <Modal
      open={!!faltantes}
      onClose={onCancelar}
      title="Stock insuficiente"
      width={560}
      footer={
        <>
          <button className={ui.btn} onClick={onCancelar} disabled={pending}>{textoCancelar}</button>
          <button className={`${ui.btn} ${ui.primary}`} onClick={onEmitir} disabled={pending}>
            <Send /> {pending ? "Emitiendo..." : "Emitir de todas formas"}
          </button>
        </>
      }
    >
      <div className={ui.stack}>
        <p>
          Según las listas de stock más recientes de los proveedores, estos ítems no alcanzan la cantidad pedida.
          Puedes emitir igual (por ejemplo, si el proveedor repone) o revisar las cantidades.
        </p>
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead>
              <tr><th>#</th><th>Ítem</th><th className={ui.num}>Pedido</th><th className={ui.num}>Disponible</th></tr>
            </thead>
            <tbody>
              {(faltantes ?? []).map((f) => (
                <tr key={`${f.orden}-${f.color ?? ""}`}>
                  <td className={ui.muted}>{f.orden + 1}</td>
                  <td>
                    <strong>{f.descripcion}</strong>
                    {f.color && <span className={ui.muted}> · {f.color}</span>}
                  </td>
                  <td className={ui.num}>{num(f.cantidad, 0)}</td>
                  <td className={ui.num} style={{ color: "var(--danger)", fontWeight: 600 }}>
                    <PackageX style={{ width: 14, height: 14, verticalAlign: -2, marginRight: 4 }} />
                    {num(f.disponible, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
