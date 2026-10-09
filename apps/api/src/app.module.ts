import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";

import { AiController } from "./ai/ai.controller.js";
import { AiService } from "./ai/ai.service.js";
import { SessionGuard } from "./auth/session.guard.js";
import { ProblemFilter } from "./common/problem.filter.js";
import { DemoController } from "./demo/demo.controller.js";
import { DemoService } from "./demo/demo.service.js";
import { HealthController } from "./health/health.controller.js";
import { HttpStudioController } from "./http-studio/http-studio.controller.js";
import { HttpStudioService } from "./http-studio/http-studio.service.js";
import { InfraModule } from "./infra/infra.module.js";
import { JudgeController } from "./judge/judge.controller.js";
import { MeController } from "./me/me.controller.js";
import { MessagesController } from "./messages/messages.controller.js";
import { MessagesService } from "./messages/messages.service.js";
import { EventsGateway } from "./realtime/events.gateway.js";
import { MetaController } from "./meta/meta.controller.js";
import { AuditService } from "./audit/audit.service.js";
import { RoomsController } from "./rooms/rooms.controller.js";
import { RoomsRepository } from "./rooms/rooms.repository.js";
import { RoomsService } from "./rooms/rooms.service.js";
import { RunnerClient } from "./runner/runner.client.js";
import { DatabasesController } from "./sandbox/databases.controller.js";
import { SandboxController } from "./sandbox/sandbox.controller.js";

const dev = process.env.NODE_ENV !== "production";

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (dev ? "debug" : "info"),
        // Session cookies and auth headers must never reach log storage.
        redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
        autoLogging: { ignore: (req) => req.url === "/api/healthz" },
        ...(dev && { transport: { target: "pino-pretty", options: { singleLine: true } } }),
      },
    }),
    InfraModule,
  ],
  controllers: [HealthController, MeController, MetaController, RoomsController, MessagesController, SandboxController, DatabasesController, AiController, JudgeController, HttpStudioController, DemoController],
  providers: [
    AiService,
    AuditService,
    DemoService,
    HttpStudioService,
    RoomsRepository,
    RoomsService,
    MessagesService,
    RunnerClient,
    EventsGateway,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
