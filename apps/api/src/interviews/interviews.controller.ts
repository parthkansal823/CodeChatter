import type { AuthSession } from "@codechatter/auth";
import {
  ExtendInterviewInput,
  InterviewId,
  InterviewToken,
  QuestionInput,
  RoomCode,
  RunInterviewTestsInput,
  ScheduleInterviewInput,
  Scorecard,
  type InterviewInvitation,
  type InterviewListItem,
  type InterviewReplay,
  type InterviewerInterview,
  type JoinedInterview,
  type QuestionData,
  type QuestionItem,
  type QuestionListItem,
  type RoomInterview,
  type ScheduleInterviewData,
  type ScheduledInterview,
} from "@codechatter/contracts";
import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Param, Post, Put, Req, Res, StreamableFile } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { Public } from "../auth/public.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { DemoService } from "../demo/demo.service.js";
import { InterviewsService } from "./interviews.service.js";

const Id = new ZodPipe(InterviewId);
const Token = new ZodPipe(InterviewToken);
const Room = new ZodPipe(RoomCode);

/** Interview mode. The service decides who may do what; views.ts decides what they see. */
@Controller()
export class InterviewsController {
  constructor(private readonly interviews: InterviewsService) {}

  // The organisation's question bank.

  @Get("interview-questions")
  listQuestions(@CurrentSession() session: AuthSession): Promise<QuestionListItem[]> {
    return this.interviews.listQuestions(session);
  }

  @Post("interview-questions")
  createQuestion(@CurrentSession() session: AuthSession, @Body(new ZodPipe(QuestionInput)) input: QuestionData): Promise<QuestionItem> {
    return this.interviews.createQuestion(session, input);
  }

  @Get("interview-questions/:id")
  getQuestion(@CurrentSession() session: AuthSession, @Param("id", Id) id: string): Promise<QuestionItem> {
    return this.interviews.getQuestion(session, id);
  }

  @Put("interview-questions/:id")
  updateQuestion(@CurrentSession() session: AuthSession, @Param("id", Id) id: string, @Body(new ZodPipe(QuestionInput)) input: QuestionData): Promise<QuestionItem> {
    return this.interviews.updateQuestion(session, id, input);
  }

  @Delete("interview-questions/:id")
  @HttpCode(204)
  archiveQuestion(@CurrentSession() session: AuthSession, @Param("id", Id) id: string): Promise<void> {
    return this.interviews.archiveQuestion(session, id);
  }

  // Interviews, for the people running them.

  @Get("interviews")
  list(@CurrentSession() session: AuthSession): Promise<InterviewListItem[]> {
    return this.interviews.list(session);
  }

  @Post("interviews")
  schedule(@CurrentSession() session: AuthSession, @Body(new ZodPipe(ScheduleInterviewInput)) input: ScheduleInterviewData): Promise<ScheduledInterview> {
    return this.interviews.schedule(session, input);
  }

  @Get("interviews/:id")
  get(@CurrentSession() session: AuthSession, @Param("id", Id) id: string): Promise<InterviewerInterview> {
    return this.interviews.get(id, session.user.id);
  }

  @Post("interviews/:id/start")
  @HttpCode(200)
  start(@CurrentSession() session: AuthSession, @Param("id", Id) id: string): Promise<InterviewerInterview> {
    return this.interviews.start(id, session.user.id);
  }

  @Post("interviews/:id/extend")
  @HttpCode(200)
  extend(@CurrentSession() session: AuthSession, @Param("id", Id) id: string, @Body(new ZodPipe(ExtendInterviewInput)) input: z.output<typeof ExtendInterviewInput>): Promise<InterviewerInterview> {
    return this.interviews.extend(id, session.user.id, input.minutes);
  }

  @Post("interviews/:id/finish")
  @HttpCode(200)
  finish(@CurrentSession() session: AuthSession, @Param("id", Id) id: string): Promise<InterviewerInterview> {
    return this.interviews.finish(id, session);
  }

  @Post("interviews/:id/cancel")
  @HttpCode(200)
  cancel(@CurrentSession() session: AuthSession, @Param("id", Id) id: string): Promise<InterviewerInterview> {
    return this.interviews.cancel(id, session.user.id);
  }

  @Post("interviews/:id/rotate-link")
  @HttpCode(200)
  rotateLink(@CurrentSession() session: AuthSession, @Param("id", Id) id: string): Promise<{ candidateToken: string }> {
    return this.interviews.rotateLink(id, session.user.id);
  }

  @Delete("interviews/:id")
  @HttpCode(204)
  remove(@CurrentSession() session: AuthSession, @Param("id", Id) id: string): Promise<void> {
    return this.interviews.remove(id, session);
  }

  @Put("interviews/:id/scorecard")
  saveScorecard(@CurrentSession() session: AuthSession, @Param("id", Id) id: string, @Body(new ZodPipe(Scorecard)) scorecard: Scorecard): Promise<InterviewerInterview> {
    return this.interviews.saveScorecard(id, session.user.id, scorecard);
  }

  @Get("interviews/:id/replay")
  replay(@CurrentSession() session: AuthSession, @Param("id", Id) id: string): Promise<InterviewReplay> {
    return this.interviews.replay(id, session.user.id);
  }

  /** The room's edit log for the replay; the frame format is in the service. */
  @Get("interviews/:id/replay/updates")
  async replayUpdates(@CurrentSession() session: AuthSession, @Param("id", Id) id: string): Promise<StreamableFile> {
    return new StreamableFile(await this.interviews.replayUpdates(id, session.user.id), { type: "application/octet-stream" });
  }

  // The room's own view, by role.

  @Get("rooms/:roomId/interview")
  forRoom(@CurrentSession() session: AuthSession, @Param("roomId", Room) roomId: string): Promise<RoomInterview> {
    return this.interviews.forRoom(roomId, session.user.id);
  }

  @Post("rooms/:roomId/interview/run-tests")
  @HttpCode(200)
  runTests(@CurrentSession() session: AuthSession, @Param("roomId", Room) roomId: string, @Body(new ZodPipe(RunInterviewTestsInput)) input: z.output<typeof RunInterviewTestsInput>) {
    return this.interviews.runTests(roomId, session, input.stateVector, input.questionId);
  }

  /** A signed-in person uses the link. The next route is for people without an account. */
  @Post("interview-invites/:token/claim")
  @HttpCode(200)
  claim(@CurrentSession() session: AuthSession, @Param("token", Token) token: string): Promise<JoinedInterview> {
    return this.interviews.claim(token, session.user.id);
  }
}

/** The candidate's link, which works without an account. */
@Controller("interview-invites")
@Public()
export class InterviewInvitesController {
  constructor(
    private readonly interviews: InterviewsService,
    private readonly demo: DemoService,
  ) {}

  @Get(":token")
  invitation(@Param("token", Token) token: string): Promise<InterviewInvitation> {
    return this.interviews.invitation(token);
  }

  /** Join without an account: a guest under the candidate's name, signed in, holding the link. */
  @Post(":token/guest")
  @HttpCode(200)
  async guest(@Param("token", Token) token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<JoinedInterview> {
    const { name } = await this.interviews.canJoinAsGuest(token);
    if (!(await this.demo.allow(req.ip ?? "unknown", 20, "interview"))) {
      throw new HttpException("Too many interview sign-ins from your network. Try again in an hour.", HttpStatus.TOO_MANY_REQUESTS);
    }
    const guest = await this.demo.createGuestAccount(name);
    const joined = await this.interviews.claim(token, guest.id);
    await this.demo.signIn(guest, req, res);
    return joined;
  }
}
