import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "isPublic";

/** Opt a route out of the global SessionGuard. Everything else requires a session. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
