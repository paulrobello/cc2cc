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
