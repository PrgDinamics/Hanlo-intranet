import type { Metadata } from "next";
import { ModuloPage } from "@/components/crud/ModuloPage";

export const metadata: Metadata = { title: "Empresas" };

export default async function Page({ searchParams }: PageProps<"/configuracion/empresas">) {
  return <ModuloPage modKey="empresas" searchParams={await searchParams} />;
}
