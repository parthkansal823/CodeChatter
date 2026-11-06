import type { Metadata } from "next";

import { BatchForm } from "@/components/interviews/batch-form";

export const metadata: Metadata = { title: "Schedule" };

/** Schedule many at once. `?mode=assessment` for a test people take alone; otherwise live interviews. */
export default async function NewBatchPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  return <BatchForm mode={mode === "assessment" ? "assessment" : "interview"} />;
}
