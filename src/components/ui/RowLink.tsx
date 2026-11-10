"use client";

import { useRouter } from "next/navigation";
import ui from "./ui.module.css";

/** Fila de tabla navegable */
export function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <tr className={ui.rowLink} onClick={() => router.push(href)} onMouseEnter={() => router.prefetch(href)}>
      {children}
    </tr>
  );
}
