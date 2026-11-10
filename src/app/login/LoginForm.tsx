"use client";

import { useActionState, useState } from "react";
import { AlertCircle, LogIn } from "lucide-react";
import { iniciarSesion } from "./actions";
import ui from "@/components/ui/ui.module.css";

export function LoginForm({ next, aviso }: { next: string; aviso?: string }) {
  const [state, action, pending] = useActionState(iniciarSesion, undefined);
  const [email, setEmail] = useState("");
  const error = state?.error ?? aviso;
  return (
    <form action={action} className={ui.stack}>
      <input type="hidden" name="next" value={next} />
      {error && (
        <div className={ui.alert}><AlertCircle /> {error}</div>
      )}
      <label className={ui.field}>
        <span className={ui.label}>Correo electrónico</span>
        <input className={ui.input} type="email" name="email" autoComplete="email" required autoFocus
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className={ui.field}>
        <span className={ui.label}>Contraseña</span>
        <input className={ui.input} type="password" name="password" autoComplete="current-password" required />
      </label>
      <button className={`${ui.btn} ${ui.primary}`} style={{ height: 40 }} disabled={pending}>
        <LogIn /> {pending ? "Ingresando..." : "Ingresar"}
      </button>
    </form>
  );
}
