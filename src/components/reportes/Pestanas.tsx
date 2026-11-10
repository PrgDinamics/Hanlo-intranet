"use client";

import { useState } from "react";
import s from "./reportes.module.css";

export function Pestanas({ tabs }: { tabs: { id: string; label: string; contenido: React.ReactNode }[] }) {
  const [activa, setActiva] = useState(tabs[0].id);
  const actual = tabs.find((t) => t.id === activa) ?? tabs[0];
  return (
    <>
      <div className={s.tabs} role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === actual.id}
            className={`${s.tab} ${t.id === actual.id ? s.tabOn : ""}`} onClick={() => setActiva(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {actual.contenido}
    </>
  );
}
