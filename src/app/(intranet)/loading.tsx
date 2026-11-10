import s from "@/components/shell/cargando.module.css";

/** Se muestra al instante al cambiar de pestaña mientras el servidor trae los datos */
export default function Cargando() {
  return (
    <div className={s.wrap} aria-busy="true" aria-label="Cargando">
      <div className={s.barra} />
      <div className={`${s.sk} ${s.titulo}`} />
      <div className={`${s.sk} ${s.sub}`} />
      <div className={s.kpis}>
        {[0, 1, 2, 3].map((i) => <div key={i} className={`${s.sk} ${s.kpi}`} />)}
      </div>
      <div className={`${s.sk} ${s.tabla}`} />
    </div>
  );
}
