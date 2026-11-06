import type { Metadata } from "next";

import { InterviewDetail } from "@/components/interviews/interview-detail";

export const metadata: Metadata = { title: "Interview" };

export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InterviewDetail id={id} />;
}
