import type { Metadata } from "next";
import { ModuloPage } from "@/components/crud/ModuloPage";

export const metadata: Metadata = { title: "Artículos" };

export default async function Page({ searchParams }: PageProps<"/articulos">) {
  return <ModuloPage modKey="articulos" searchParams={await searchParams} />;
}
