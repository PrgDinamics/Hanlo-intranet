import type { Metadata } from "next";
import { ModuloPage } from "@/components/crud/ModuloPage";

export const metadata: Metadata = { title: "Agentes comerciales" };

export default async function Page({ searchParams }: PageProps<"/configuracion/agentes">) {
  return <ModuloPage modKey="agentes" searchParams={await searchParams} />;
}
