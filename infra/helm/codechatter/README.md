# CodeChatter on Kubernetes

The whole app on one cluster, and each room's sandbox, databases and package proxy there too: a namespace per room, made by the runner (`RUNNER_DRIVER=kubernetes`). The defaults run a complete demo on Docker Desktop's built-in Kubernetes, or on `kind`.

## Try it on Docker Desktop

1. Turn on Kubernetes in Docker Desktop (Settings, Kubernetes).
2. Build the images (the cluster uses the ones on this machine):

   ```sh
   pnpm k8s:images        # web, api, collab, runner, migrate
   pnpm sandbox:build     # the rooms' sandbox (or sandbox:build:full for every language)
   ```

3. Install:

   ```sh
   helm install codechatter infra/helm/codechatter --namespace codechatter --create-namespace
   ```

   Without Helm on this machine, the full sandbox image has it:

   ```sh
   docker run --rm -v "$PWD/infra/helm/codechatter:/chart:ro" --entrypoint helm codechatter-sandbox:full \
     template codechatter /chart --namespace codechatter | kubectl apply -n codechatter -f -
   ```

4. Open http://localhost:8090 and sign in as `test1@codechatter.local` (password `codechatter123`). Sign-up emails arrive at http://localhost:8090/mail/.

Uninstall with `helm uninstall codechatter -n codechatter`, then delete the rooms' namespaces: `kubectl delete namespace -l codechatter.namespace=demo`.

## What runs

| Part | What | Reached by |
|---|---|---|
| edge | Caddy: every route on one origin, as `infra/caddy` does for Docker | browsers, as a LoadBalancer on port 8090 |
| web | Next.js | the edge |
| api | NestJS: REST, auth, Socket.IO, terminals, previews | the edge and web |
| collab | Hocuspocus: the shared documents | the edge, and the runner as a peer |
| runner | each room's sandbox, databases and package proxy, on this cluster | the API only |
| postgres, valkey | the app's data | the app |
| mailpit | catches the demo's emails | the edge (`/mail/`) |

The API and collab apply the database migrations before they start, and the demo seed loads the test accounts once the API is up.

## Security

- **Pods.** Every pod runs as a non-root user, with a read-only root file system, no capabilities, seccomp, and no Kubernetes token (apart from the runner).
- **The runner's access** is what it does to rooms: namespaces, pods and their exec, services, volume claims, StatefulSets and network policies.
  - It may write Secrets (a room's database password) but not read any.
  - Kubernetes RBAC can't limit a role to some namespaces by name, so a ValidatingAdmissionPolicy does: the runner may change only `cc-<namespace>-*` namespaces and what's in them.
- **Rooms** are as on Docker (ADR 0007, 0008):
  - A `room` network policy lets a room's pods reach each other and nothing else.
  - The sandbox has no DNS server; its room's services are in `/etc/hosts`.
  - The package proxy alone may go out, to DNS and public HTTPS.

## Production

Set these in your values:

- `url`: your `https://` address. Put TLS in front of the edge (an Ingress, or `edge.service.type: ClusterIP` behind one).
- `previewOrigin`: a separate domain for previews, so a dev server can't share the app's cookies.
- `images.registry` and a pinned `images.tag`; `runner.sandbox.image` pinned too, with `runner.sandbox.pull: IfNotPresent`.
- `seed: false`, and `mail.mailpit: false` with your `mail.smtp`.
- `postgres.externalUrl` (a managed database, or CloudNativePG) and `valkey.externalUrl`, or keep the bundled ones with a backup plan.
- Secrets: give `secrets.*`, or let the chart generate them on install. It keeps them on upgrades.
- The cluster must enforce NetworkPolicies (Calico, Cilium, or kindnet with kube-network-policies, as on Docker Desktop).
- The kubelet should set a pod process limit (`podPidsLimit`). The sandbox limits its own processes, but databases rely on the node's limit.
