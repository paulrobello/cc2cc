// hub/src/validation.ts
/**
 * Re-exports the canonical instanceId regex from @cc2cc/shared.
 *
 * Previously this file held an independent copy of the pattern; it now
 * delegates to the single source of truth so the two can never silently drift.
 */
export { INSTANCE_ID_RE } from "@cc2cc/shared";
