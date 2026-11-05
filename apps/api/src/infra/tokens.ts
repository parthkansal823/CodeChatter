// Injection tokens for the process-wide singletons provided by InfraModule.
export const ENV = Symbol("ENV");
export const DB = Symbol("DB");
export const VALKEY = Symbol("VALKEY");
export const AUTH = Symbol("AUTH");
export const ORIGINS = Symbol("ORIGINS");
export const PREVIEW_HOSTS = Symbol("PREVIEW_HOSTS");
/** The object store for rooms' binary files (`ObjectStore | null`: null when S3_* aren't set). */
export const OBJECT_STORE = Symbol("OBJECT_STORE");
