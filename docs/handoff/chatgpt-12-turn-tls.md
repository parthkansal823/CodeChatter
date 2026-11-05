# Task for ChatGPT: calls that get through HTTPS-only networks (TURN over TLS), plus tests for relay and screen sharing

You are helping build **CodeChatter v2**, a real-time collaborative IDE with video calls in each room (LiveKit). Another AI works on other parts of the codebase at the same time, so **only create or change the files listed under "Files you may touch"**. The owner does all git himself.

You (ChatGPT) already added LiveKit to production Compose and the Helm chart, with LiveKit's built-in **TURN over UDP 3478**. As the docs you wrote say, that leaves out networks that allow only HTTPS (many offices, schools and hotels): UDP 3478, UDP 7882 and TCP 7881 are all blocked there. Your job is to close that gap with **TURN over TLS on TCP 443**, and to prove the relay and screen sharing work with browser tests.

## What exists (read these files in the repository first)

- **LiveKit 1.13.11:**
  - production config `infra/livekit/livekit.yaml`;
  - development config `infra/livekit/livekit.dev.yaml` (no TURN);
  - LiveKit's own documentation of the `turn:` keys (`enabled`, `domain`, `tls_port`, `udp_port`, `external_tls`, `cert_file`, `key_file`) is its `config-sample.yaml` for that version.
- **Production Compose** (`infra/compose.yaml`) and **Caddy** (`infra/caddy/Caddyfile`, image `caddy:2.11-alpine`):
  - Caddy owns TCP 80 and 443 and the site's certificates (`{$DOMAIN}`, automatic HTTPS), and routes `/livekit*` to `livekit:7880` for signalling.
  - LiveKit publishes TCP 7881 and UDP 7882 and 3478.
- **Helm:** `infra/helm/codechatter/` (`templates/livekit.yaml`, `templates/edge.yaml` for the Caddy edge, `values.yaml` `livekit:`) and its README.
- **Deploy docs:** `docs/deploy.md`, section "Calls (video and voice)".
- **The browser side:** `apps/web/components/room/call/call-store.ts`:
  - `new Room({ adaptiveStream: true, dynacast: true })`, then `room.connect(url, token)`;
  - screen share through `setScreenShareEnabled(…, { audio: false })`.
- **The existing call test:** `apps/web/test/call.e2e.mjs`. It launches Edge with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` through `launch({ args })` from `apps/web/test/browser.mjs`. Two people join and video flows.

## What to build

1. **TURN over TLS on 443, on one server, without taking 443 away from the website.** The usual way is to route by name: `turn.<DOMAIN>` goes to LiveKit's TURN, and everything else to the site. Choose one design, explain why, and implement it:
   - **(a) Caddy with the layer-4 module.** Build the image in `infra/docker/caddy.Dockerfile` from `caddy:2.11-builder` with `xcaddy build --with github.com/mholt/caddy-l4@<pinned>`. Caddy routes TLS by SNI on 443: `turn.<DOMAIN>` is terminated by Caddy (which gets its certificate) and passed as plain TCP to LiveKit's TURN with `turn.external_tls: true`; the rest goes to the HTTP app as now.
   - **(b) Caddy keeps the certificates, and LiveKit terminates TLS itself** on a second public IP, or on 443 of a separate host. Only choose this if (a) can't work, and say why.

   Whichever you choose:
   - `TURN_DOMAIN` defaults to `turn.${DOMAIN}`, and the docs say to add its DNS record;
   - LiveKit's `turn.domain` is set, so the ICE servers it gives browsers say `turns:turn.<DOMAIN>:443?transport=tcp`;
   - the UDP 3478 TURN stays.
2. **Helm:** the same idea for Kubernetes.
   - The usual route is a separate `LoadBalancer` on 443 for the TURN TLS port, with a certificate from a Secret (`livekit.turn.tls.secretName`; cert-manager, if the cluster has it, is documented, not required). Or `external_tls` behind the cluster's TCP/TLS load balancer.
   - Values decide, with the same kind of guards as the media Service (`fail` with a clear message on a mismatch).
3. **Development, to make relays testable:**
   - Turn on TURN over UDP in `infra/livekit/livekit.dev.yaml` (port 3478, published in `infra/compose.dev.yaml`), so a test can force relaying. Check that nothing else on the machine uses 3478; say how to change it if something does.
   - In `call-store.ts`, honour `?callRelay=1` on the room URL **only when `process.env.NODE_ENV !== "production"`**. It connects with `{ rtcConfig: { iceTransportPolicy: "relay" } }`, so media must go through TURN.
4. **Browser tests:**
   - **`apps/web/test/call-relay.e2e.mjs`:** two people join with `?callRelay=1`, and video flows. Check through `RTCPeerConnection.getStats()` that the selected candidate pair is of type `relay`; expose a test-only hook if needed, explain it, and keep it out of production builds. Without the relay, the test should fail: say how you know.
   - **`apps/web/test/call-screen-share.e2e.mjs`:** one person shares their screen, and the other sees the large shared tile with frames arriving.
     - Use Chromium's flags for an automatic screen pick, such as `--auto-select-desktop-capture-source=Entire screen` or `--auto-accept-this-tab-capture`, and say which works with Edge.
     - Then stop sharing, and check the tile goes away for the other person.
   - Both follow `call.e2e.mjs`: the test room E2ETST, accounts test1 and test2 (password `codechatter123`), and no page errors.
5. **Docs:**
   - `docs/deploy.md`: the DNS record, the ports (now including TCP 443 for TURN through the chosen route), and how to check TURN from outside. Show the `turnutils_uclient` command or a browser check (chrome://webrtc-internals, the candidate types), and what it looks like when it works.
   - The chart README: the Helm equivalent.

## Files you may touch

- `infra/livekit/livekit.yaml`, `infra/livekit/livekit.dev.yaml`, `infra/compose.yaml`, `infra/compose.dev.yaml` (the TURN port only), `infra/caddy/Caddyfile`, `infra/docker/caddy.Dockerfile` (new, if you choose (a))
- `infra/helm/codechatter/values.yaml`, `templates/livekit.yaml`, `templates/edge.yaml`, `README.md`
- `apps/web/components/room/call/call-store.ts` (the development-only relay switch, and a test hook if needed)
- `apps/web/test/call-relay.e2e.mjs`, `apps/web/test/call-screen-share.e2e.mjs` (new)
- `docs/deploy.md`

## How to answer

1. Each new file in full, and each edit as a unified diff with enough context.
2. The owner's commands to check it:
   - `docker compose -f infra/compose.yaml config` (with a test env), and `docker build -f infra/docker/caddy.Dockerfile .` if added;
   - `helm lint` and `helm template`;
   - after `pnpm infra:up` (restarting LiveKit with the new dev config): from `apps/web`, `node test/call-relay.e2e.mjs`, `node test/call-screen-share.e2e.mjs` and `node test/call.e2e.mjs`, which must still pass.

## Check your work before you answer

Review your own answer before sending it, and put this review at the end, under **Self-check**. The owner's other AI checks every answer against the repository before it's used. Problems you find and fix yourself save a round trip; a "Done" that isn't true costs one.

1. **The brief, point by point.** A table with one row for each requirement in "What to build":

   | Requirement | Done, Partly or Not done | Where (file and function) | How you know |
   |---|---|---|---|

   Only write Done when the code in your answer does it. If something is Partly or Not done, say what's missing and why.
2. **The rules.** Confirm each one, or say where you broke it and why:
   - you changed only the files under "Files you may touch";
   - no new packages, apart from any this brief allows (and then you gave the exact command);
   - in `apps/api`, `apps/collab`, `apps/runner` and `packages/*`, relative imports end in `.js`;
   - in web files, no hex, `rgb()` or `hsl()` colours, only token classes; copy is plain English;
   - every new file starts with a doc comment saying what it is and why;
   - nothing logs, prints or returns a secret.
3. **What you assumed about existing code.** List every name you used but didn't see in this brief or in the files you read: a function, column, route, prop, environment variable or test helper. For each, say whether you read it in the repository or guessed it. Guesses are the first thing the owner checks.
4. **Walk through the tests.** For each test or check you wrote, say which part of your code makes it pass. Then write down at least one way the feature could break that no test covers.
5. **Edge cases.** The failure cases you handled (bad input, no permission, a network error, two people at once, a retry, a restart) and the ones you didn't.
6. **Scope for improvement.** What you'd do next, and anything in the existing code you read that looks wrong or could be better. Keep it separate from this task: list it, don't build it.
