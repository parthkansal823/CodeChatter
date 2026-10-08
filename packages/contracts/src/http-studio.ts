/**
 * API Studio: the shared request model, the send contract, and the pure
 * helpers both sides need (variable substitution, request resolution,
 * imports and exports, checks). The browser resolves variables (secrets
 * never leave it except inside the request being sent); the API only ever
 * sees a finished request.
 */
export * from "./http-studio/checks.js";
export * from "./http-studio/curl.js";
export * from "./http-studio/json-lines.js";
export * from "./http-studio/request.js";
export * from "./http-studio/send.js";
export * from "./http-studio/snippets.js";
