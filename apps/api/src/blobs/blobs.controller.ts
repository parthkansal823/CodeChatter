import type { AuthSession } from "@codechatter/auth";
import type { ObjectStore } from "@codechatter/auth/s3";
import { BLOB_MAX_BYTES, BlobCopyInput, blobKey, RoomCode, typeForName, type BlobRef } from "@codechatter/contracts";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { OBJECT_STORE } from "../infra/tokens.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { blobResponseHeaders, parseRange } from "./blob-headers.js";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "That isn't a file's SHA-256.");
const MediaType = /^[a-z0-9][\w.+-]*\/[\w.+-]+$/;
const UploadQuery = z.strictObject({ name: z.string().max(255).optional(), type: z.string().max(255).optional() });
const DownloadQuery = z.strictObject({ download: z.string().min(1).max(255).optional() });

/**
 * A room's binary files (images, PDFs, fonts…), kept in the object store under
 * the room (`blobKey`). The file tree only holds each file's SHA-256, size and
 * type; anyone who can edit uploads bytes here and then adds the file to the
 * tree, and anyone who can see the room reads them back.
 *
 * Uploads come as the raw body (application/octet-stream, the real type in
 * `?type=`), so no body parser touches them; they're hashed as they arrive and
 * refused past BLOB_MAX_BYTES.
 */
@Controller("rooms/:roomId/blobs")
export class BlobsController {
  constructor(
    @Inject(OBJECT_STORE) private readonly store: ObjectStore | null,
    private readonly rooms: RoomsService,
  ) {}

  @Post()
  @HttpCode(201)
  async upload(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Query(new ZodPipe(UploadQuery)) query: z.infer<typeof UploadQuery>,
    @Req() request: Request,
  ): Promise<BlobRef> {
    await this.rooms.require(roomId, session.user.id, "files.edit");
    const store = this.requireStore();
    const { bytes, sha256 } = await readBody(request, BLOB_MAX_BYTES);
    const asked = query.type?.toLowerCase().split(";")[0]!.trim();
    const type = asked && MediaType.test(asked) && asked !== "application/octet-stream" ? asked : typeForName(query.name ?? "");
    const key = blobKey(roomId, sha256);
    // The same bytes are stored once per room, whatever they're called.
    if (!(await store.head(key))) await store.put(key, bytes, type);
    return { sha256, size: bytes.byteLength, type };
  }

  /** Copy blobs from a room you can see into this one (a fork brings its images along). */
  @Post("copy")
  @HttpCode(200)
  async copy(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Body(new ZodPipe(BlobCopyInput)) input: BlobCopyInput,
  ): Promise<{ copied: number; missing: string[] }> {
    await this.rooms.require(roomId, session.user.id, "files.edit");
    await this.rooms.require(input.from, session.user.id, "room.view");
    const store = this.requireStore();
    const wanted = [...new Set(input.sha256)];
    const missing: string[] = [];
    let copied = 0;
    for (let i = 0; i < wanted.length; i += 8) {
      await Promise.all(
        wanted.slice(i, i + 8).map(async (sha256) => {
          const to = blobKey(roomId, sha256);
          const ok = (await store.head(to)) !== null || (await store.copy(blobKey(input.from, sha256), to));
          if (ok) copied += 1;
          else missing.push(sha256);
        }),
      );
    }
    return { copied, missing };
  }

  @Get(":sha256")
  async download(
    @CurrentSession() session: AuthSession,
    @Param("roomId", new ZodPipe(RoomCode)) roomId: string,
    @Param("sha256", new ZodPipe(Sha256)) sha256: string,
    @Query(new ZodPipe(DownloadQuery)) query: z.infer<typeof DownloadQuery>,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.rooms.require(roomId, session.user.id, "room.view");
    const store = this.store;
    if (!store) throw new NotFoundException("Binary files aren't set up on this server.");
    if (request.headers["if-none-match"] === `"${sha256}"`) {
      response.status(304).end();
      return;
    }
    const object = await store.get(blobKey(roomId, sha256));
    if (!object) throw new NotFoundException("That file's bytes aren't in this room.");
    response.set(blobResponseHeaders({ type: object.contentType, sha256, download: query.download }));
    const range = parseRange(request.headers.range, object.body.byteLength);
    if (range === "unsatisfiable") {
      response.status(416).set("Content-Range", `bytes */${object.body.byteLength}`).end();
      return;
    }
    if (range) {
      response
        .status(206)
        .set("Content-Range", `bytes ${range.start}-${range.end}/${object.body.byteLength}`)
        .end(object.body.subarray(range.start, range.end + 1));
      return;
    }
    response.status(200).end(object.body);
  }

  private requireStore(): ObjectStore {
    if (!this.store) {
      throw new ServiceUnavailableException("Binary files aren't set up on this server (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY).");
    }
    return this.store;
  }
}

/** The raw body, hashed as it arrives; refused (and the rest drained) past `max` bytes. */
async function readBody(request: Request, max: number): Promise<{ bytes: Buffer; sha256: string }> {
  const tooLarge = () => new PayloadTooLargeException(`Files can be up to ${Math.round(max / 1024 / 1024)} MB.`);
  if (Number(request.headers["content-length"]) > max) {
    request.resume();
    throw tooLarge();
  }
  if (request.readableEnded) throw new BadRequestException("Send the file's bytes as the request body (application/octet-stream).");
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) {
      request.resume();
      throw tooLarge();
    }
    hash.update(chunk);
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks), sha256: hash.digest("hex") };
}
