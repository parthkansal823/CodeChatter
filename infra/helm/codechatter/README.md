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
- `objectStore` (endpoint, region, bucket, accessKey, secretKey): an S3-compatible bucket for rooms' binary files (images, PDFs, fonts), reached by the API and the runner. Without it, binary files are off and uploads say so (`docs/deploy.md`, Binary files).
- Secrets: give `secrets.*`, or let the chart generate them on install. It keeps them on upgrades.
- The cluster must enforce NetworkPolicies (Calico, Cilium, or kindnet with kube-network-policies, as on Docker Desktop).
- The kubelet should set a pod process limit (`podPidsLimit`). The sandbox limits its own processes, but databases rely on the node's limit.

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
