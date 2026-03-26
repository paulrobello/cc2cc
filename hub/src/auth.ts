// hub/src/auth.ts

import { timingSafeEqual } from "node:crypto";

/**
 * Timing-safe comparison of two strings to prevent timing attacks on API key validation.
 * Pads both buffers to the same length before comparison so that the early-return
 * path on length mismatch cannot be used as a length oracle.
 */
export function keysEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  const maxLen = Math.max(bufA.length, bufB.length);
  // Pad both buffers to equal length so timingSafeEqual always runs in constant time
  const paddedA = Buffer.alloc(maxLen);
  const paddedB = Buffer.alloc(maxLen);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  // Compare lengths separately (not early-return) and combine with timing-safe result
  const lengthsMatch = bufA.length === bufB.length;
  const contentsMatch = timingSafeEqual(paddedA, paddedB);
  return lengthsMatch && contentsMatch;
}
