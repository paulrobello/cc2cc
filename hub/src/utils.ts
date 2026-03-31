// hub/src/utils.ts

/**
 * Parse the bare project segment from a cc2cc instanceId.
 * Format: username@host:project/session_uuid
 *
 * Exported as a standalone utility so it can be imported without pulling in
 * the full topic-manager dependency graph.
 */
export function parseProject(instanceId: string): string {
  const colonPart = instanceId.split(":")[1] ?? "";
  return colonPart.split("/")[0] ?? instanceId;
}

/**
 * Sanitize a project name into a valid topic name.
 * Strips leading dots/non-alphanumeric chars, replaces invalid chars with hyphens,
 * lowercases, and truncates to 64 chars.
 * Falls back to "default" if the result would be empty.
 */
export function sanitizeProjectTopic(project: string): string {
  const sanitized = project
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, "") // strip leading non-alphanumeric
    .replace(/[^a-z0-9_-]/g, "-") // replace invalid chars with hyphens
    .replace(/-+/g, "-") // collapse consecutive hyphens
    .replace(/-$/, "") // strip trailing hyphen
    .slice(0, 64);
  return sanitized || "default";
}
