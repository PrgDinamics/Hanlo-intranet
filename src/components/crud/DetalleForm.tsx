"use client";

import { useRouter } from "next/navigation";
import { MODULOS } from "@/lib/modulos";
import { RegistroForm, type Refs } from "./RegistroForm";

export function DetalleForm({
  modKey, registro, refs, consulta, soloLectura,
}: { modKey: string; registro: Record<string, unknown>; refs: Refs; consulta?: boolean; soloLectura?: boolean }) {
  const router = useRouter();
  return (
    <RegistroForm
      modKey={modKey}
      registro={registro}
      refs={refs}
      consulta={consulta}
      soloLectura={soloLectura}
      onSaved={() => router.refresh()}
      onDeleted={() => router.push(MODULOS[modKey].ruta)}
    />
  );
}
