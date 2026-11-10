import type { Metadata } from "next";
import { ModuloPage } from "@/components/crud/ModuloPage";

export const metadata: Metadata = { title: "Líneas" };

export default async function Page({ searchParams }: PageProps<"/lineas">) {
  return <ModuloPage modKey="lineas" searchParams={await searchParams} />;
}
