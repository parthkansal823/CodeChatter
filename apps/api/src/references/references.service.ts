/** Fetches a reference's BibTeX for the References tool, as rooms have no internet: from doi.org for a DOI, and arXiv for an arXiv id. Only a checked id reaches a request, and only known hosts are followed. */
import { parseReferenceId } from "@codechatter/contracts";
import { BadGatewayException, Inject, Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { Redis } from "ioredis";

import { RateLimiter } from "../ai/rate-limit.js";
import { VALKEY } from "../infra/tokens.js";

const HOSTS = new Set(["doi.org", "dx.doi.org", "api.crossref.org", "data.crossref.org", "data.crosscite.org", "citation.crosscite.org", "api.datacite.org", "data.datacite.org", "arxiv.org", "export.arxiv.org"]);
const MOST_REDIRECTS = 5;
const MOST_BYTES = 128 * 1024;
const TIMEOUT_MS = 12_000;

export type Fetcher = typeof fetch;

/** A request that can't leave the known hosts, however it's redirected. */
async function fetchFollowing(start: string, init: RequestInit, fetcher: Fetcher): Promise<Response> {
  let url = start;
  for (let hop = 0; hop <= MOST_REDIRECTS; hop++) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !HOSTS.has(parsed.hostname)) throw new BadGatewayException("That reference is somewhere this can't read from.");
    const response = await fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const next = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (!next) return response;
    url = new URL(next, url).toString();
  }
  throw new BadGatewayException("That reference was redirected too many times.");
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MOST_BYTES) {
      await reader.cancel();
      throw new BadGatewayException("What came back was too long to be one reference.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The BibTeX for a DOI or arXiv id. Exported for its tests, with a fetch of their own. */
export async function lookUpReference(input: string, fetcher: Fetcher = fetch): Promise<string> {
  const reference = parseReferenceId(input);
  if (!reference) throw new UnprocessableEntityException("That doesn't look like a DOI or an arXiv id. They look like 10.1038/nature14539 and 1706.03762.");
  const url = reference.kind === "doi" ? `https://doi.org/${reference.id.split("/").map(encodeURIComponent).join("/")}` : `https://arxiv.org/bibtex/${reference.id.split("/").map(encodeURIComponent).join("/")}`;
  let response: Response;
  try {
    response = await fetchFollowing(url, { headers: { accept: "application/x-bibtex; charset=utf-8", "user-agent": "CodeChatter references" } }, fetcher);
  } catch (error) {
    if (error instanceof BadGatewayException) throw error;
    throw new BadGatewayException("Couldn't reach the service that keeps this reference. Try again in a moment.");
  }
  if (response.status === 404) throw new UnprocessableEntityException(`Nothing was found for ${reference.id}.`);
  if (!response.ok) throw new BadGatewayException("The service that keeps this reference didn't answer properly. Try again in a moment.");
  const bibtex = (await readLimited(response)).trim();
  if (!/^@\w+\s*[{(]/.test(bibtex)) throw new BadGatewayException("What came back wasn't a reference.");
  return bibtex;
}

@Injectable()
export class ReferencesService {
  private readonly limiter: RateLimiter;

  constructor(@Inject(VALKEY) redis: Redis) {
    this.limiter = new RateLimiter(redis, { limit: 30, windowSeconds: 60, prefix: "references:rate" });
  }

  hit(userId: string) {
    return this.limiter.hit(userId);
  }

  lookUp(id: string) {
    return lookUpReference(id);
  }
}
