import type { Metadata } from "next";
import { ModuloPage } from "@/components/crud/ModuloPage";

export const metadata: Metadata = { title: "Proveedores" };

export default async function Page({ searchParams }: PageProps<"/proveedores">) {
  return <ModuloPage modKey="proveedores" searchParams={await searchParams} />;
}
