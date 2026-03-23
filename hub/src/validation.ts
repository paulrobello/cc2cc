// hub/src/validation.ts
/**
 * Validates the instanceId format: username@host:project/session
 * Tightened to reject shell metacharacters and control characters that could
 * be injected into Redis keys or log output.
 * Allows alphanumeric, dots, underscores, hyphens in each segment.
 * Project segment: 1–64 chars. Session segment: 1–64 chars.
 */
export const INSTANCE_ID_RE =
  /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]{1,64}\/[a-zA-Z0-9-]{1,64}$/;
