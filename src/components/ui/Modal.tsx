"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import s from "./Modal.module.css";
import ui from "./ui.module.css";

export function Modal({
  open, onClose, title, children, footer, width = 620,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.modal} style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className={s.head}>
          <h2 className={s.title}>{title}</h2>
          <button type="button" className={`${ui.btn} ${ui.ghost} ${ui.icon}`} onClick={onClose} aria-label="Cerrar">
            <X />
          </button>
        </div>
        <div className={s.body}>{children}</div>
        {footer && <div className={s.foot}>{footer}</div>}
      </div>
    </div>
  );
}
