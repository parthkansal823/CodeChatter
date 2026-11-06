import type { AuthSession } from "@codechatter/auth";
import { AiReviewInput, InterviewId, type InterviewerInterview } from "@codechatter/contracts";
import { Body, Controller, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";

import { AuditService } from "../audit/audit.service.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { InterviewAiReviewService } from "./interview-ai-review.service.js";

/** Ask the AI what to check and what to ask, for a sitting. What it was shown goes in the audit log. */
@Controller("interviews/:id/ai-review")
export class InterviewAiReviewController {
  constructor(
    private readonly reviews: InterviewAiReviewService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @HttpCode(200)
  async review(@CurrentSession() session: AuthSession, @Param("id", new ZodPipe(InterviewId)) id: string, @Body(new ZodPipe(AiReviewInput)) input: AiReviewInput, @Req() request: Request): Promise<InterviewerInterview> {
    const { interview, orgId, looked } = await this.reviews.review(id, session, input);
    await this.audit.record({ orgId, actorId: session.user.id, action: "interview.ai-review", targetType: "interview", targetId: id, data: { camera: looked.camera, screen: looked.screen, model: interview.aiReview?.model ?? "" } }, request);
    return interview;
  }
}
