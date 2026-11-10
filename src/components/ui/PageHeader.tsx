import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import ui from "./ui.module.css";

export function PageHeader({
  title, subtitle, back, actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <div className={ui.pageHead}>
      <div>
        {back && (
          <Link href={back.href} className={ui.back}>
            <ChevronLeft /> {back.label}
          </Link>
        )}
        <h1 className={ui.pageTitle}>{title}</h1>
        {subtitle && <p className={ui.pageSub}>{subtitle}</p>}
      </div>
      {actions && <div className={ui.actions}>{actions}</div>}
    </div>
  );
}
