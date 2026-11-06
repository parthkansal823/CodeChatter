# CodeChatter on Kubernetes

The whole app on one cluster, and each room's sandbox, databases and package proxy there too: a namespace per room, made by the runner (`RUNNER_DRIVER=kubernetes`). The defaults run a complete demo on Docker Desktop's built-in Kubernetes, or on `kind`.

## Try it on Docker Desktop

1. Turn on Kubernetes in Docker Desktop (Settings, Kubernetes).
2. Build the images (the cluster uses the ones on this machine):

   ```sh
   pnpm k8s:images        # web, api, collab, runner, migrate
   pnpm sandbox:build     # the rooms' sandbox (or sandbox:build:full for every language)
   docker build -t codechatter-backup:pg18-rclone1.70.3 infra/backup
   ```

3. Install:

   ```sh
   helm install codechatter infra/helm/codechatter --namespace codechatter --create-namespace \
     --set livekit.rtc.useExternalIp=false --set-string livekit.rtc.nodeIp=127.0.0.1 \
     --set livekit.rtc.enableLoopbackCandidate=true \
     --set-string 'livekit.turn.allowRestrictedPeerCidrs[0]=127.0.0.1/32'
   ```

   Without Helm on this machine, the full sandbox image has it:

   ```sh
   docker run --rm -v "$PWD/infra/helm/codechatter:/chart:ro" --entrypoint helm codechatter-sandbox:full \
     template codechatter /chart --namespace codechatter \
       --set livekit.rtc.useExternalIp=false --set-string livekit.rtc.nodeIp=127.0.0.1 \
       --set livekit.rtc.enableLoopbackCandidate=true \
       --set-string 'livekit.turn.allowRestrictedPeerCidrs[0]=127.0.0.1/32' | kubectl apply -n codechatter -f -
   ```

4. Open http://localhost:8090 and sign in as `test1@codechatter.local` (password `codechatter123`). Sign-up emails arrive at http://localhost:8090/mail/. Calls use `ws://localhost:8090/livekit`; the media LoadBalancer must also expose TCP 7881 and UDP 7882 and 3478 on localhost. The overrides above advertise localhost, enable loopback ICE, and allow TURN to relay to this one loopback address. They are for browsers on this computer only; a browser on another computer needs a reachable IP instead.

   Check `kubectl get svc codechatter-livekit-media -n codechatter`. Docker Desktop must support a mixed TCP/UDP LoadBalancer; a pending service or TCP-only forwarding leaves signalling working while calls fail. `kubectl port-forward` carries TCP only and cannot replace these UDP ports. If an existing Compose/dev LiveKit uses these ports, configure different listener ports and matching public forwarding for the Kubernetes copy.

Uninstall with `helm uninstall codechatter -n codechatter`, then delete the rooms' namespaces: `kubectl delete namespace -l codechatter.namespace=demo`.

## What runs

| Part | What | Reached by |
|---|---|---|
| edge | Caddy: every route on one origin, as `infra/caddy` does for Docker | browsers, as a LoadBalancer on port 8090 |
| web | Next.js | the edge |
| api | NestJS: REST, auth, Socket.IO, terminals, previews | the edge and web |
| collab | Hocuspocus: the shared documents | the edge, and the runner as a peer |
| livekit | calls, with built-in TURN over UDP | signalling through the edge (`/livekit`); media and TURN through a separate LoadBalancer |
| runner | each room's sandbox, databases and package proxy, on this cluster | the API only |
| postgres, valkey | the app's data | the app |
| backup | verified nightly Postgres dumps, retained on a PVC and optionally S3 | the CronJob; no public service |
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
- `postgres.externalUrl` (a managed database, or CloudNativePG) and `valkey.externalUrl`, or keep bundled Postgres with the nightly backups below.
- `objectStore` (endpoint, region, bucket, accessKey, secretKey): an S3-compatible bucket for rooms' binary files (images, PDFs, fonts), reached by the API and the runner. Without it, binary files are off and uploads say so (`docs/deploy.md`, Binary files).
- Secrets: give `secrets.*`, or let the chart generate them on install. It keeps them on upgrades.
- The cluster must enforce NetworkPolicies (Calico, Cilium, or kindnet with kube-network-policies, as on Docker Desktop).
- The kubelet should set a pod process limit (`podPidsLimit`). The sandbox limits its own processes, but databases rely on the node's limit.

## Database backups

Bundled Postgres gets a `backup` CronJob by default. It runs at 03:00 in `backup.timeZone` (UTC by default), with `concurrencyPolicy: Forbid`, one retry, a one-hour start deadline and a six-hour run deadline. Kubernetes 1.27 or newer is required for the native CronJob `timeZone` field. `backup.schedule`, the deadlines, resource limits and Job history limits are configurable. The container runs as UID/GID 70 with the chart's security settings, a read-only root, writable `/tmp` and a `10Gi` backup PVC.

The extra image combines the Postgres 18 clients with pinned rclone 1.70.3. Build it with the command above. For a remote cluster, publish the image to your registry and set `backup.image` to that pinned image; the default pull policy is `IfNotPresent`. The chart's ConfigMap mounts the same four scripts as Compose: `entrypoint.sh`, `common.sh`, `backup.sh` and `restore.sh`. The Docker-only test checks that the embedded script bodies exactly match `infra/backup`.

Backups include the PostgreSQL schema and data: accounts, rooms, Yjs text documents, checkpoints, chat, audit and webhook records. Valkey and sandbox volumes are excluded. Room binary files and recordings live in the application's separate object-store bucket; only their database references are in a dump. Protect that bucket separately with versioning, replication or its provider's backup policy.

`backup.retention` keeps the union of the latest seven distinct daily dates, four Sundays and six first-of-month dates, with the newest backup always protected. Each custom-format dump has a SHA-256 sidecar, is checked with `pg_restore --list`, and is published only after completion. Local copies are under `/backups` on `<release>-backups`. The PVC has `helm.sh/resource-policy: keep`, so uninstalling the release leaves it in place. Reuse that claim on reinstall; delete it explicitly only after independently confirming the offsite copies you need.

Without S3, logs and installation NOTES clearly say the copies remain local. For offsite copies, create a dedicated Secret from a private file containing `BACKUP_S3_URL`, `BACKUP_S3_ACCESS_KEY` and `BACKUP_S3_SECRET_KEY`. Optional keys are `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION` (default `us-east-1`) and `BACKUP_S3_FORCE_PATH_STYLE` (default `true`). Use a separate backup bucket or prefix, with read/list/write/delete permission on that prefix for retention and restores. Keep the bucket private.

```sh
kubectl create secret generic codechatter-backup-s3 -n codechatter \
  --from-env-file=/secure/codechatter-backup-s3.env
```

Set the existing Secret's name in values; no credentials need to be passed on the Helm command line:

```yaml
backup:
  s3:
    existingSecret: codechatter-backup-s3
```

Alternatively, `backup.s3.url`, `endpoint`, `region`, `accessKey`, `secretKey` and `forcePathStyle` create a dedicated chart Secret when `url` is set. Helm stores those values in its release record, so prefer `existingSecret` in production. That option takes precedence over inline S3 settings. Do not publish rendered manifests: the chart's other resources include generated credentials too.

When `postgres.externalUrl` is set, no backup ConfigMap, PVC, Secret or CronJob is rendered, and NOTES says why. Use the managed database's backups and restore drills. `backup.enabled: false` also skips these resources; disabling bundled Postgres skips them as well.

Check the schedule and recent work (replace the release and namespace as needed):

```sh
kubectl get cronjob codechatter-backup -n codechatter
kubectl get jobs -n codechatter -l app.kubernetes.io/component=backup
kubectl get cronjob codechatter-backup -n codechatter \
  -o jsonpath='{.status.lastSuccessfulTime}'
kubectl create job --from=cronjob/codechatter-backup \
  codechatter-backup-manual-$(date -u +%s) -n codechatter
```

Alert when `status.lastSuccessfulTime` is absent after the first scheduled run, or older than 26 hours. A Job completing successfully means its dump was verified, retention completed and any configured S3 upload succeeded. `/backups/last-success` holds a UTC epoch timestamp; `/backups/last-failure` holds a sanitized failure reason. Job failure alerts and the age check cover different failures: no scheduled Job cannot update the status files. See the [Kubernetes CronJob reference](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) for scheduling and history behavior.

Do a monthly scratch restore using the same Job template and PVC. Choose a real dump basename from the backup logs, or an `s3://bucket/prefix/codechatter-<timestamp>.dump` key. This creates a new `codechatter_restore_<stamp>` database; it does not replace `codechatter`:

```sh
kubectl create job --from=cronjob/codechatter-backup codechatter-restore-drill \
  -n codechatter --dry-run=client -o yaml \
  | kubectl patch --local -f - --type=json -o yaml \
      -p='[{"op":"replace","path":"/spec/template/spec/containers/0/args","value":["restore","/backups/codechatter-<UTC timestamp>.dump"]}]' \
  | kubectl apply -n codechatter -f -
kubectl logs -n codechatter -f job/codechatter-restore-drill
kubectl wait -n codechatter --for=condition=complete job/codechatter-restore-drill --timeout=1h
```

Good means the checksum and restore succeed and row counts for `user`, `rooms`, `doc_snapshots`, `checkpoints` and `audit_events` match the expected backup data. Remove the scratch database after inspection, then delete the drill Job so the name can be reused. The full [deployment restore procedure](../../../docs/deploy.md#backups) covers cleanup and a real live restore. Live replacement requires stopped app services, `BACKUP_APP_STOPPED=yes` and typing the exact database name interactively; do not put those settings on the nightly CronJob.

## Calls and TURN

`livekit.enabled: true` runs one pinned `livekit/livekit-server:v1.13.11` server. The existing chart Secret stores its API key and secret, generated on install and kept on Helm upgrades unless `secrets.livekitApiKey` or `secrets.livekitApiSecret` overrides them. Both the API and LiveKit read these same credentials; the ConfigMap contains no keys. A server replacement interrupts active calls; this chart does not configure a multi-node LiveKit cluster.

When rotating either credential, update it through Helm and restart both Deployments (`kubectl rollout restart deployment/codechatter-livekit deployment/codechatter-api -n codechatter`, replacing the release name and namespace as needed). Secret-backed environment variables are read when a pod starts; changing the Secret alone does not update running API or LiveKit processes. LiveKit configuration changes do trigger its rollout through the ConfigMap checksum.

The API's public `LIVEKIT_URL` defaults to `url` with `http` changed to `ws` and `/livekit` appended. An HTTPS `url` therefore becomes `wss://<host>/livekit`. `livekit.url` can override it; use an address browsers can reach, rather than a cluster service name. The private ClusterIP service exposes signalling on 7880 only to the edge. Set `livekit.enabled: false` to remove LiveKit, its edge route and the API's three LiveKit settings; the Call button then says calls are not configured.

Media does not pass through Caddy or an HTTP Ingress. The default `livekit.media.service.type: LoadBalancer` publishes TCP 7881 (ICE/TCP), UDP 7882 (ICE/UDP mux) and UDP 3478 (TURN). It requires a provider supporting TCP and UDP on the same service, including UDP forwarding, and reachable inbound firewall rules for all three ports. Add provider settings in `livekit.media.service.annotations`. `loadBalancerIP` is optional and provider-dependent; use the provider's static-address annotation where required. `externalTrafficPolicy: Local` preserves source addresses and sends traffic only to nodes with the single LiveKit pod.

The address LiveKit advertises must actually deliver those ports to its pod. `rtc.useExternalIp: true` discovers an address with STUN; this may be a node or NAT egress address instead of a service LoadBalancer's address. For a LoadBalancer, reserve a public IPv4 address, set `livekit.rtc.useExternalIp: false` and set `livekit.rtc.nodeIp` to that address. Merely creating a LoadBalancer or setting `loadBalancerIP` does not configure LiveKit's advertised IP. The pod must also be able to reach this address on its media port for embedded TURN. If that address is private, add only its exact `/32` to `livekit.turn.allowRestrictedPeerCidrs`; leave the list empty for a public address. Never allow an entire private network through TURN.

For example, these production values use a reserved LoadBalancer address. Replace the documentation IP with your reachable address and configure the provider's address reservation:

```yaml
url: https://code.example.com
livekit:
  rtc:
    useExternalIp: false
    nodeIp: "203.0.113.10"
    enableLoopbackCandidate: false
  turn:
    allowRestrictedPeerCidrs: []
  media:
    service:
      type: LoadBalancer
      loadBalancerIP: "203.0.113.10"
```

With `NodePort`, clients reach a node's public IP instead. The advertised listener ports must equal the external NodePorts; Kubernetes normally permits only 30000–32767. This example changes both sides together, and the template rejects mismatched NodePort values:

```yaml
livekit:
  rtc:
    useExternalIp: false
    nodeIp: "203.0.113.20"
    tcpPort: 30881
    udpPort: 30882
  turn:
    udpPort: 30478
  media:
    service:
      type: NodePort
      nodePorts: { tcp: 30881, udp: 30882, turn: 30478 }
```

Open TCP 30881, UDP 30882 and UDP 30478 on that node and direct them to the same ports without rewriting. With `externalTrafficPolicy: Local`, use the node hosting the LiveKit pod; if it moves, the advertised address and routing must follow. Production needs a stable node placement/address or a suitable LoadBalancer. A generic HTTP Ingress does not provide this media routing. The edge's separate HTTPS/TLS setup still needs its usual public HTTP/HTTPS ports.

TURN is enabled with UDP only (`tls_port: 0`). It helps when a browser needs a relay but still permits UDP to the server. Networks blocking UDP need TURN over TCP/TLS; that is not provided by these values. Adding TURN/TLS on 443 needs a separate address or an L4 arrangement because the app's HTTPS edge already uses 443. The embedded relay's dynamic sockets are internal; this chart exposes the documented client-facing TURN port rather than an additional public relay range. LoadBalancer/NAT return routing must still be verified with a forced-relay browser call.

After installing, check signalling with `curl https://code.example.com/livekit/` (or `curl http://localhost:8090/livekit/` for the demo); it should return `OK`. Then connect two browser sessions to the same room and test microphone, camera and screen sharing. An `OK` response verifies only signalling. Check the selected ICE pair in the browser's WebRTC diagnostics and repeat with a client forcing `iceTransportPolicy: "relay"` to exercise TURN. A direct call or a healthy pod does not verify relay connectivity.

Validate the chart before installation with `helm lint infra/helm/codechatter` and `helm template codechatter infra/helm/codechatter`. Rendered Secrets contain credentials, so do not publish the output. Network choices follow the [LiveKit port reference](https://docs.livekit.io/home/self-hosting/ports-and-firewall/), [Kubernetes guidance](https://docs.livekit.io/home/self-hosting/kubernetes/) and the pinned [server configuration](https://github.com/livekit/livekit/blob/v1.13.11/config-sample.yaml).
