/** The References tool's lookup: a DOI or arXiv id to BibTeX. It adds to the room's files, so it needs edit rights, and an interview isn't the place for it. */
import type { AuthSession } from "@codechatter/auth";
import { ReferenceLookupInput, RoomCode, type ReferenceLookup } from "@codechatter/contracts";
import { Body, Controller, ForbiddenException, Header, HttpCode, HttpException, HttpStatus, Param, Post } from "@nestjs/common";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { ReferencesService } from "./references.service.js";

@Controller("rooms/:roomId/references")
export class ReferencesController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly references: ReferencesService,
  ) {}

  @Post("lookup")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  async lookup(@CurrentSession() session: AuthSession, @Param("roomId", new ZodPipe(RoomCode)) roomId: string, @Body(new ZodPipe(ReferenceLookupInput)) input: ReferenceLookupInput): Promise<ReferenceLookup> {
    const { room } = await this.rooms.require(roomId, session.user.id, "files.edit");
    if (room.kind === "interview") throw new ForbiddenException("This isn't available in an interview.");
    const limit = await this.references.hit(session.user.id);
    if (!limit.allowed) throw new HttpException(`That's a lot of lookups. Try again in ${limit.retryAfterSeconds} seconds.`, HttpStatus.TOO_MANY_REQUESTS);
    return { bibtex: await this.references.lookUp(input.id) };
  }
}
