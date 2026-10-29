import type { SecretFinding } from "@codechatter/contracts";

/** An RFC 9457 problem returned by the API, surfaced as a typed error. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly errors?: Array<{ path: string; message: string }>,
    /** What the secret scan found in a commit, publish or gist it refused. */
    readonly secrets?: SecretFinding[],
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

/**
 * Same-origin fetch to the NestJS API through Caddy. The session cookie rides
 * along automatically; nothing is kept in JS-readable storage (v1 kept the
 * JWT in sessionStorage, twice).
 */
export async function api<T>(path: `/api/${string}`, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const response = await fetch(path, {
    credentials: "same-origin",
    ...rest,
    headers: { accept: "application/json", ...(json !== undefined && { "content-type": "application/json" }), ...headers },
    ...(json !== undefined && { body: JSON.stringify(json) }),
  });

  if (response.ok) {
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  let detail = response.statusText || "Request failed";
  let errors: ApiError["errors"];
  let secrets: ApiError["secrets"];
  try {
    const problem = (await response.json()) as { detail?: string; errors?: ApiError["errors"]; secrets?: ApiError["secrets"] };
    detail = problem.detail ?? detail;
    errors = problem.errors;
    secrets = problem.secrets;
  } catch {
    // Non-JSON error body (proxy error page): keep the status text.
  }
  throw new ApiError(response.status, detail, errors, secrets);
}
