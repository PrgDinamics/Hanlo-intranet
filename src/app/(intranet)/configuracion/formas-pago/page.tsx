import type { Metadata } from "next";
import { ModuloPage } from "@/components/crud/ModuloPage";

export const metadata: Metadata = { title: "Formas de pago" };

export default async function Page({ searchParams }: PageProps<"/configuracion/formas-pago">) {
  return <ModuloPage modKey="formas_pago" searchParams={await searchParams} />;
}
