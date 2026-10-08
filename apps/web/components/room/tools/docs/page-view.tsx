"use client";

import { DocumentPage } from "./document-page";
import type { PageRecord } from "./pages-model";

/** One open page. Databases (database/) get their own view once their UI lands; until then nothing creates them. */
export function PageView({ page }: { page: PageRecord }) {
  return <DocumentPage page={page} />;
}
