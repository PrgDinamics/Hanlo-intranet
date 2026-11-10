import s from "./Logo.module.css";

/** Wordmark HANLO INNOVA (letras de acento en amarillo, como el logo de la marca) */
export function Logo({ fondo = "oscuro", tam = 20 }: { fondo?: "oscuro" | "claro"; tam?: number }) {
  return (
    <span className={`${s.logo} ${fondo === "claro" ? s.claro : s.oscuro}`} style={{ fontSize: tam }} aria-label="Hanlo Innova">
      <span>HA<em>N</em>LO</span>
      <span><em>INN</em>OVA</span>
    </span>
  );
}
