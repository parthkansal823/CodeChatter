# ADR 0007: Each room's sandbox is on a private network of its own, with package installs on request

- **Status:** Accepted (2026-10-09). Builds on ADR 0003, whose sandboxes had no network at all.
- **Code:**
  - the network: `apps/runner/src/sandbox.ts` (`ensureNetwork`), `apps/runner/src/subnets.ts`
  - installs: `apps/runner/src/egress.ts`, `sandbox/agent/src/egress.ts` (the proxy), `sandbox/agent/src/relay.ts`, `PACKAGE_REGISTRIES` in `packages/contracts/src/sandbox.ts`
- **Tests:** `apps/runner/test/network.e2e.mjs`, `apps/runner/test/egress.e2e.mjs`, `apps/web/test/installs.e2e.mjs`, `sandbox/agent/src/egress-policy.test.ts`

## Context

One-click databases, framework installs and real Kubernetes all need the sandbox to talk to other containers: a room's Postgres, and a way to package registries. With `NetworkMode: none` it can't. Anything that lets it talk must not let it reach the host, the app's own database, other rooms, cloud metadata or the internet at large.

## Decision: the room network

Each room gets a Docker bridge network, `cc-<namespace>-net-<room>`, made when its sandbox starts:

- **Internal**, so it has no route out.
- **Gateway mode `isolated`** (Docker 28+), so the bridge has no address on the host at all. A plain internal network still has a gateway address on the host; Docker drops traffic to it today, but with no address there is nothing to reach.
- **Its own /26 of `SANDBOX_SUBNET`** (default `10.213.0.0/16`, room for 1,024 rooms). Docker's default address pools hold only about 30 networks, which a busy server would run out of. The runner takes the lowest block that overlaps no existing network, and tries the next if Docker refuses.

The sandbox joins only this network. The room's services join it later and are reached by name, for example `postgres:5432`. When a room has had no container for a day, the runner's sweep removes its network.

A sandbox made before this, or whose network was remade, is recreated on its next start, as it already was for a new image. The files live on the volume.

## Decision: package installs

Off by default. The room's owner (`sandbox.network`) allows them from the Ports panel for an hour at a time; the API records each switch in the audit log (`sandbox.installs.allow` and `.stop`).

- **A proxy per room, only while allowed.** The runner starts `cc-<namespace>-egress-<room>` from the sandbox image with the proxy as its entrypoint, on the room's network (alias `egress`) and on one shared way out, `cc-<namespace>-egress`, where proxies can't reach each other. It has a read-only root, no capabilities and small limits.
- **Registries, and nothing else.** It opens HTTPS tunnels (CONNECT, port 443) to the hosts in `PACKAGE_REGISTRIES` only, matched exactly. Plain HTTP, other ports, other hosts and IP addresses are refused with a reason. A name that resolves into a private, loopback, link-local or reserved range is refused too, so DNS can't point it back inside.
- **Off on time.** The proxy exits by itself at the end of the hour, even if the runner is down; the sweep removes it. Turning installs off removes it at once.
- **A relay with a reason.** Every terminal and Run has `HTTPS_PROXY=http://127.0.0.1:3128`, so package managers need no setup. The agent's relay on that port passes connections to `egress`, or, when installs are off, answers `403 This room has no internet…`, which pip and npm show, instead of a DNS error about a host called egress.
- **A home that lasts.** `/home/ccuser` is now a per-room volume rather than a 64 MB tmpfs, so npm's, pip's and Cargo's caches fit and make repeat installs fast. `pip install` installs for the user (the root filesystem is read-only), and `npm install -g` goes to `~/.local`.

Considered and not chosen:
- **One shared proxy on every room's network.** It would be reachable by every room all the time, and "off" would only be a flag inside it.
- **An HTTP cache in the proxy.** It can't see inside HTTPS tunnels without intercepting TLS. The package managers' own caches on the home volume do the job.

## Evidence

Probes from containers on Docker 29.7 (Docker Desktop):

| Target | Default bridge | Internal | Internal, isolated |
|---|---|---|---|
| App Postgres through a host address | open | dropped (timeout) | no route |
| App Postgres container | open | no route | no route |
| Runner on the host (`host.docker.internal`) | open | no DNS | no DNS |
| Internet (1.1.1.1:443) and outside DNS | open | no route, no DNS | no route, no DNS |
| A service on the same network, by name | n/a | n/a | open |
| Another room's network | n/a | n/a | no route |

`network.e2e.mjs` runs the same checks against a real room sandbox. A positive control is part of it: a service on the room's network must answer. That way "everything blocked" can't pass just because networking is broken.

`egress.e2e.mjs` covers installs, with installs off, on and expired.

## Consequences

- Failed DNS lookups in a sandbox now answer `EAI_AGAIN` from Docker's DNS instead of failing to reach a resolver. They still fail at once.
- Allowing installs also lets any program that honours `HTTPS_PROXY` (for example `requests` in Python) reach the registries, and only them. Other sites get a clear 403.
- Maven and Gradle don't read `HTTPS_PROXY`; neither is in the images yet. When they are, their proxy settings go in the image.
- The home volume, like the workspace volume, has no size limit yet; disk quotas come with production hardening.

## On Kubernetes (2026-10-09)

With `RUNNER_DRIVER=kubernetes` each room is a namespace, and the same rule holds through a NetworkPolicy, `room`, made with the namespace before any pod:

- every pod in the namespace (the sandbox, and later its databases and package proxy) takes connections only from the namespace's pods, and makes them only to the namespace's pods
- so not another room, the Kubernetes API, the node's kubelet, the Docker Desktop host, cloud metadata or the internet
- policies need a network plugin that enforces them. Docker Desktop's cluster (kindnet, with kube-network-policies) does; so do Calico and Cilium
- the sandbox pod has no DNS server (`dnsPolicy: None`, nameserver 127.0.0.1), so a lookup fails at once, as on Docker, rather than after the resolver's timeouts. CoreDNS would also answer outside names, which leaks data through lookups. The room's own services will get `/etc/hosts` entries (`hostAliases`) to their Service addresses when they run on Kubernetes (roadmap K3, K4)

`network.e2e.mjs` asks the runner which driver it runs and checks both: 11 checks on Kubernetes, 10 on Docker.

### Package installs on Kubernetes (2026-10-10)

- the proxy runs as a pod named `egress` in the room's namespace (`kube-egress.ts`), from the sandbox image, as the agent's user, locked down like the sandbox
- a second NetworkPolicy, `egress`, selects only that pod and lets it out to the cluster's DNS (port 53) and to public addresses on 443. Private, link-local and shared ranges are excepted, and the proxy refuses private addresses itself too
- the sandbox reaches it through a Service named `egress`, which is in its `/etc/hosts` from the start
- with no proxy running, that Service has no pods behind it. A pod outside any policy gets "connection refused" from it at once; the room's policy, though, drops the connection unanswered (kube-network-policies ignores an `ipBlock` for a Service address). So the sandbox's relay waits 2 seconds for the proxy and then answers "403 This room has no internet", as on Docker, where the name doesn't resolve then
- the proxy exits when its time is up; `activeDeadlineSeconds` ends the pod a minute later if it hasn't, and the sweep deletes ended proxy pods
