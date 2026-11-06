import type { Metadata } from "next";

import { JoinInterview } from "@/components/interviews/join-interview";

export const metadata: Metadata = {
  title: "Your interview",
  robots: { index: false, follow: false },
  // The link is the candidate's key: it stays out of the Referer of anything this page loads.
  referrer: "no-referrer",
};

/** The candidate's link. It's public: the token is what lets them in, and only the API checks it. */
export default async function InterviewLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinInterview token={token} />;
}
