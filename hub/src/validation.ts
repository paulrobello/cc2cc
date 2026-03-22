// hub/src/validation.ts
/**
 * Validates the instanceId format: username@host:project/session
 * The session segment accepts any non-empty string (not just UUID4)
 * to support Claude session IDs.
 */
export const INSTANCE_ID_RE = /^[^@]+@[^:]+:.+\/.+$/;
