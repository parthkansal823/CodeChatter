import type { Metadata } from "next";

import { PageHeader } from "@/components/app/app-shell";
import { QuestionForm } from "@/components/interviews/question-form";

export const metadata: Metadata = { title: "New question" };

export default function NewQuestionPage() {
  return (
    <>
      <PageHeader title="New question" description="Saved to your organisation's question bank." />
      <QuestionForm />
    </>
  );
}
