import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";

import { AiController } from "./ai/ai.controller.js";
import { AiService } from "./ai/ai.service.js";
import { SessionGuard } from "./auth/session.guard.js";
import { ProblemFilter } from "./common/problem.filter.js";
import { DemoController } from "./demo/demo.controller.js";
import { DemoService } from "./demo/demo.service.js";
import { GithubController } from "./github/github.controller.js";
import { GithubService } from "./github/github.service.js";
import { SourceControlController } from "./github/source-control.controller.js";
import { SourceControlService } from "./github/source-control.service.js";
import { WebhookController } from "./github/webhook.controller.js";
import { HealthController } from "./health/health.controller.js";
import { CallsController } from "./calls/calls.controller.js";
import { CheckpointsController } from "./history/checkpoints.controller.js";
import { ActivityService } from "./notifications/activity.service.js";
import { NotificationsController } from "./notifications/notifications.controller.js";
import { NotificationsService } from "./notifications/notifications.service.js";
import { CheckpointsService } from "./history/checkpoints.service.js";
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
import { AuditController } from "./audit/audit.controller.js";
import { BlobsController } from "./blobs/blobs.controller.js";
import { GitController } from "./sandbox/git.controller.js";
import { InterviewInvitesController, InterviewsController } from "./interviews/interviews.controller.js";
import { InterviewsService } from "./interviews/interviews.service.js";
import { RoomsController } from "./rooms/rooms.controller.js";
import { RoomsRepository } from "./rooms/rooms.repository.js";
import { RoomsService } from "./rooms/rooms.service.js";
import { RunnerClient } from "./runner/runner.client.js";
import { DatabasesController } from "./sandbox/databases.controller.js";
import { RoomJanitor } from "./rooms/room-janitor.js";
import { KubernetesController } from "./sandbox/kubernetes.controller.js";
import { SqliteController } from "./sandbox/sqlite.controller.js";
import { DuckdbController } from "./sandbox/duckdb.controller.js";
import { NotebooksController } from "./sandbox/notebooks.controller.js";
import { SandboxController } from "./sandbox/sandbox.controller.js";
import { WebhooksController } from "./webhooks/webhooks.controller.js";
import { WebhooksService } from "./webhooks/webhooks.service.js";
import { DependenciesController } from "./dependencies/dependencies.controller.js";
import { DependenciesService } from "./dependencies/dependencies.service.js";

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
  controllers: [HealthController, MeController, GithubController, MetaController, RoomsController, MessagesController, SandboxController, DatabasesController, SqliteController, DuckdbController, NotebooksController, KubernetesController, SourceControlController, WebhookController, CheckpointsController, NotificationsController, CallsController, AiController, JudgeController, HttpStudioController, DemoController, AuditController, WebhooksController, DependenciesController, BlobsController, GitController, InterviewsController, InterviewInvitesController],
  providers: [
    AiService,
    InterviewsService,
    ActivityService,
    AuditService,
    WebhooksService,
    DependenciesService,
    CheckpointsService,
    NotificationsService,
    DemoService,
    GithubService,
    SourceControlService,
    HttpStudioService,
    RoomJanitor,
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
