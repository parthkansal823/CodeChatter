import { createHmac, randomUUID } from "node:crypto";

/**
 * A LiveKit access token: the JWT (HS256, signed with the server's API secret) a browser
 * shows LiveKit to join one call. It says who you are (`sub`, `name`), which call, and
 * what you may do there (the `video` grant). Made here with Node's own crypto, as
 * LiveKit documents its tokens, so the API needs no LiveKit package.
 */
export type CallGrant = {
  apiKey: string;
  apiSecret: string;
  /** Stable per person: their user id. */
  identity: string;
  name: string;
  /** LiveKit's room (one per CodeChatter room). */
  room: string;
  /** Send your camera, microphone and screen (and data); otherwise watch and listen only. */
  canPublish: boolean;
  /** Seen by everyone in the call (the presence slot, for the tile's colour). */
  metadata?: string;
  ttlSeconds?: number;
  now?: number;
};

const base64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

export function livekitToken(grant: CallGrant): string {
  const issued = Math.floor((grant.now ?? Date.now()) / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: grant.apiKey,
    sub: grant.identity,
    name: grant.name,
    jti: randomUUID(),
    nbf: issued,
    iat: issued,
    exp: issued + (grant.ttlSeconds ?? 6 * 60 * 60),
    ...(grant.metadata && { metadata: grant.metadata }),
    video: {
      room: grant.room,
      roomJoin: true,
      canSubscribe: true,
      canPublish: grant.canPublish,
      canPublishData: grant.canPublish,
      canUpdateOwnMetadata: false,
    },
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", grant.apiSecret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}
