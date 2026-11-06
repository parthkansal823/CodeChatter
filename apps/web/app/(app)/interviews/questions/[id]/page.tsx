"use client";

import type { QuestionItem } from "@codechatter/contracts";
import { useQuery } from "@tanstack/react-query";
import { use } from "react";

import { PageHeader } from "@/components/app/app-shell";
import { QuestionForm } from "@/components/interviews/question-form";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

export default function EditQuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const question = useQuery({ queryKey: ["interview-question", id], queryFn: ({ signal }) => api<QuestionItem>(`/api/interview-questions/${id}`, { signal }), gcTime: 0 });
  return (
    <>
      <PageHeader title="Edit question" description="Interviews already scheduled keep the version they were scheduled with." />
      {question.isPending && <div className="grid max-w-3xl gap-3 px-6 py-6 sm:px-8"><Skeleton className="h-8" /><Skeleton className="h-40" /></div>}
      {question.isError && <p className="px-6 py-6 text-muted-foreground sm:px-8">This question couldn&apos;t load. It may have been removed.</p>}
      {question.data && <QuestionForm key={question.data.id} question={question.data} />}
    </>
  );
}
