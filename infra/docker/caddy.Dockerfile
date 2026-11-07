# Add pinned TCP/SNI routing so TURN/TLS and the website share public TCP 443.
FROM caddy:2.11-builder AS builder
RUN GOMAXPROCS=2 GOFLAGS=-p=2 xcaddy build v2.11.0 \
    --with github.com/mholt/caddy-l4@8e984fe3cfd65719a13339ded5a91b48e6d0cf7e

FROM caddy:2.11-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
