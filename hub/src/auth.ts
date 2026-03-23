// hub/src/auth.ts

import { timingSafeEqual } from "node:crypto";

/**
 * Timing-safe comparison of two strings to prevent timing attacks on API key validation.
 */
export function keysEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
