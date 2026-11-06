import type { Metadata } from "next";

import { BatchResultsPage } from "@/components/interviews/batch-results";

export const metadata: Metadata = { title: "Results" };

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BatchResultsPage id={id} />;
}
