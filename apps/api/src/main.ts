import "reflect-metadata";

import type { Auth, OriginPolicy } from "@codechatter/auth";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { toNodeHandler } from "better-auth/node";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module.js";
import type { Env } from "./config/env.js";
import { AUTH, ENV, ORIGINS, PREVIEW_HOSTS, VALKEY } from "./infra/tokens.js";
import { previewProxy, type PreviewHosts } from "./preview/preview-proxy.js";
import { attachTerminalProxy } from "./realtime/terminal.proxy.js";
import { ValkeyIoAdapter } from "./realtime/valkey-io.adapter.js";
import { RoomsService } from "./rooms/rooms.service.js";
import { RunnerClient } from "./runner/runner.client.js";

// Better Auth must read the raw request body, so Nest's parser is disabled
// and re-enabled only after the auth handler is mounted.
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, bufferLogs: true });
app.useLogger(app.get(Logger));
app.enableShutdownHooks();

const env = app.get<Env>(ENV);
const express = app.getHttpAdapter().getInstance();

// Caddy is the single ingress hop; trust exactly one proxy for req.ip.
express.set("trust proxy", 1);
express.disable("x-powered-by");
// Preview hosts (p3000-room.preview…) are answered before anything else: they
// are a separate origin and never reach the app's routes.
const preview = previewProxy({
  env,
  hosts: app.get<PreviewHosts>(PREVIEW_HOSTS),
  rooms: app.get(RoomsService),
  runner: app.get(RunnerClient),
  redis: app.get(VALKEY),
});
express.use(preview.http);
express.all("/api/auth/{*splat}", toNodeHandler(app.get<Auth>(AUTH)));

app.useBodyParser("json", { limit: "1mb" });
app.useWebSocketAdapter(new ValkeyIoAdapter(app, env.VALKEY_URL));
app.setGlobalPrefix("api");
preview.attach(app.getHttpServer());
// Browser terminals (/ws/terminal) share the HTTP server with Socket.IO.
attachTerminalProxy(app.getHttpServer(), {
  auth: app.get<Auth>(AUTH),
  origins: app.get<OriginPolicy>(ORIGINS),
  rooms: app.get(RoomsService),
  runner: app.get(RunnerClient),
});

await app.listen(env.API_PORT);
app.get(Logger).log(`API listening on :${env.API_PORT} (public origin ${env.APP_URL})`);
