// Liveness probe for the container health check and the load balancer.
export function GET() {
  return new Response("ok", { headers: { "cache-control": "no-store" } });
}
