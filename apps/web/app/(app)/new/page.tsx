import { redirect } from "next/navigation";

/**
 * "Open in CodeChatter": /new?repo=owner/name (or a GitHub link) opens New room on that
 * repository, after sign-in when needed (proxy.ts keeps the link in returnTo).
 */
export default async function NewRoomPage({ searchParams }: { searchParams: Promise<{ repo?: string }> }) {
  const { repo } = await searchParams;
  redirect(repo ? `/dashboard?repo=${encodeURIComponent(repo)}` : "/dashboard");
}
