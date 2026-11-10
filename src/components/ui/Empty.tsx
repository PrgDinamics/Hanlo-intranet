import { Inbox } from "lucide-react";
import ui from "./ui.module.css";

export function Empty({ children = "No hay registros todavía" }: { children?: React.ReactNode }) {
  return (
    <div className={ui.empty}>
      <Inbox />
      <div>{children}</div>
    </div>
  );
}
