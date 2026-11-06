import type { AuthSession } from "@codechatter/auth";
import {
  AskQuestionInput,
  HeartbeatInput,
  ImportQuestionsInput,
  InterviewId,
  InterviewToken,
  MarkAnswerInput,
  RoomCode,
  SaveAnswerInput,
  ScheduleBatchInput,
  SetInterviewAiInput,
  StartAssessmentInput,
  type AskQuestionData,
  type AskedQuestion,
  type BatchListItem,
  type BatchResults,
  type CandidateAnswer,
  type ImportQuestionsData,
  type InterviewerInterview,
  type JoinedInterview,
  type ScheduleBatchData,
  type ScheduledBatch,
} from "@codechatter/contracts";
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { InterviewTestsService } from "./interview-tests.service.js";
import { InterviewsService } from "./interviews.service.js";

const Id = new ZodPipe(InterviewId);
const Room = new ZodPipe(RoomCode);
const QuestionRef = new ZodPipe(z.string().min(1).max(64));

/** Many candidates at once, questions asked during an interview, the AI switch, answers and marks, and the integrity record. */
@Controller()
export class InterviewTestsController {
  constructor(
    private readonly tests: InterviewTestsService,
    private readonly interviews: InterviewsService,
  ) {}

  /** Fill the bank in one go. All of them or none. */
  @Post("interview-questions/import")
  importQuestions(@CurrentSession() session: AuthSession, @Body(new ZodPipe(ImportQuestionsInput)) input: ImportQuestionsData): Promise<{ imported: number }> {
    return this.interviews.importQuestions(session, input.questions);
  }

  // Many candidates at once.

  @Post("interview-batches")
  schedule(@CurrentSession() session: AuthSession, @Body(new ZodPipe(ScheduleBatchInput)) input: ScheduleBatchData): Promise<ScheduledBatch> {
    return this.tests.scheduleBatch(session, input);
  }

  @Get("interview-batches")
  list(@CurrentSession() session: AuthSession): Promise<BatchListItem[]> {
    return this.tests.listBatches(session);
  }

  @Get("interview-batches/:id")
  results(@CurrentSession() session: AuthSession, @Param("id", Id) id: string): Promise<BatchResults> {
    return this.tests.results(id, session.user.id);
  }

  @Delete("interview-batches/:id")
  @HttpCode(204)
  remove(@CurrentSession() session: AuthSession, @Param("id", Id) id: string): Promise<void> {
    return this.tests.removeBatch(id, session);
  }

  // During a live interview: the interviewer's.

  /** Ask a question now: from the bank, at random, or made up on the spot. */
  @Post("interviews/:id/questions")
  ask(@CurrentSession() session: AuthSession, @Param("id", Id) id: string, @Body(new ZodPipe(AskQuestionInput)) input: AskQuestionData): Promise<AskedQuestion> {
    return this.interviews.askQuestion(id, session.user.id, input);
  }

  /** Ask a question that's been waiting on the paper. */
  @Post("interviews/:id/questions/:questionId/ask")
  @HttpCode(200)
  askPrepared(@CurrentSession() session: AuthSession, @Param("id", Id) id: string, @Param("questionId", QuestionRef) questionId: string): Promise<AskedQuestion> {
    return this.interviews.askPrepared(id, session.user.id, questionId);
  }

  @Post("interviews/:id/ai")
  @HttpCode(200)
  setAi(@CurrentSession() session: AuthSession, @Param("id", Id) id: string, @Body(new ZodPipe(SetInterviewAiInput)) input: { allowed: boolean }): Promise<InterviewerInterview> {
    return this.interviews.setAi(id, session.user.id, input.allowed);
  }

  @Put("interviews/:id/answers/:questionId/marks")
  mark(@CurrentSession() session: AuthSession, @Param("id", Id) id: string, @Param("questionId", QuestionRef) questionId: string, @Body(new ZodPipe(MarkAnswerInput)) input: { marks: number }): Promise<InterviewerInterview> {
    return this.tests.mark(id, session.user.id, questionId, input.marks);
  }

  // The candidate's.

  /** Start an assessment, once the link is theirs. */
  @Post("interview-invites/:token/start")
  @HttpCode(200)
  start(@CurrentSession() session: AuthSession, @Param("token", new ZodPipe(InterviewToken)) token: string, @Body(new ZodPipe(StartAssessmentInput)) input: { consent: boolean }): Promise<JoinedInterview> {
    return this.interviews.startAssessment(token, session.user.id, input.consent);
  }

  @Put("rooms/:roomId/interview/answers/:questionId")
  answer(
    @CurrentSession() session: AuthSession,
    @Param("roomId", Room) roomId: string,
    @Param("questionId", QuestionRef) questionId: string,
    @Body(new ZodPipe(SaveAnswerInput)) input: z.output<typeof SaveAnswerInput>,
  ): Promise<CandidateAnswer> {
    return this.tests.saveAnswer(roomId, session.user.id, questionId, input);
  }

  @Post("rooms/:roomId/interview/submit")
  @HttpCode(204)
  submit(@CurrentSession() session: AuthSession, @Param("roomId", Room) roomId: string): Promise<void> {
    return this.tests.submit(roomId, session);
  }

  @Post("rooms/:roomId/interview/heartbeat")
  @HttpCode(200)
  heartbeat(@CurrentSession() session: AuthSession, @Param("roomId", Room) roomId: string, @Body(new ZodPipe(HeartbeatInput)) input: z.output<typeof HeartbeatInput>, @Req() request: Request): Promise<{ status: string }> {
    return this.tests.heartbeat(roomId, session.user.id, request.ip ?? "unknown", input);
  }
}
