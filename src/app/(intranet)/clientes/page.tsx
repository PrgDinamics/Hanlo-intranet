import type { Metadata } from "next";
import { ModuloPage } from "@/components/crud/ModuloPage";

export const metadata: Metadata = { title: "Clientes" };

export default async function Page({ searchParams }: PageProps<"/clientes">) {
  return <ModuloPage modKey="clientes" searchParams={await searchParams} />;
}
