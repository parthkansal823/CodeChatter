import type { Metadata } from "next";
import { Suspense } from "react";

import { InterviewsPage } from "@/components/interviews/interviews-page";

export const metadata: Metadata = { title: "Interviews" };

export default function Page() {
  return (
    <Suspense>
      <InterviewsPage />
    </Suspense>
  );
}
