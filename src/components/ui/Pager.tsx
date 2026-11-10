import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ui from "./ui.module.css";

export const PAGE_SIZE = 25;

export function Pager({
  page, total, params, path,
}: { page: number; total: number; params: Record<string, string | undefined>; path: string }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const sp = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    sp.set("p", String(p));
    return `${path}?${sp}`;
  };
  return (
    <div className={ui.pager}>
      <span>{total} registro{total === 1 ? "" : "s"}</span>
      <div className={ui.row}>
        {page > 1 && (
          <Link className={`${ui.btn} ${ui.sm}`} href={href(page - 1)}><ChevronLeft /> Anterior</Link>
        )}
        <span>Página {page} de {pages}</span>
        {page < pages && (
          <Link className={`${ui.btn} ${ui.sm}`} href={href(page + 1)}>Siguiente <ChevronRight /></Link>
        )}
      </div>
    </div>
  );
}

export function pageRange(p: string | undefined) {
  const page = Math.min(100_000, Math.max(1, Math.floor(Number(p)) || 1));
  return { page, from: (page - 1) * PAGE_SIZE, to: page * PAGE_SIZE - 1 };
}
