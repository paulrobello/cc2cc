// plugin/src/config.ts
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface PluginConfig {
  /** Hub WebSocket URL, e.g. ws://192.168.1.10:3100 */
  hubUrl: string;
  /** Shared API key — must match CC2CC_HUB_API_KEY on the hub */
  apiKey: string;
  /** Username component of the instance ID */
  username: string;
  /** Hostname component of the instance ID */
  host: string;
  /** Project component of the instance ID (cwd basename by default) */
  project: string;
  /**
   * The session segment of the instance ID — either read from the session file
   * or a random UUIDv4 fallback. Tracked separately for change detection in the
   * session file watcher.
   */
  sessionId: string;
  /**
   * Fully-qualified instance ID: username@host:project/sessionId
   * Generated fresh on each loadConfig() call so each plugin start is unique.
   */
  instanceId: string;
  /** Full WebSocket URL including auth: ws://<hubUrl>/ws/plugin?key=<apiKey>&instanceId=<instanceId> */
  wsUrl: string;
}

/**
 * Build a fully-qualified instance ID from config parts and a session ID.
 *
 * @returns `"${username}@${host}:${project}/${sessionId}"`
 */
export function buildInstanceId(
  config: Omit<PluginConfig, "instanceId" | "wsUrl" | "sessionId">,
  sessionId: string,
): string {
  return `${config.username}@${config.host}:${config.project}/${sessionId}`;
}

/**
 * Build the full WebSocket URL with encoded auth query parameters.
 *
 * @returns `"${hubUrl}/ws/plugin?key=<encodedApiKey>&instanceId=<encodedInstanceId>"`
 */
export function buildWsUrl(hubUrl: string, apiKey: string, instanceId: string): string {
  return `${hubUrl}/ws/plugin?key=${encodeURIComponent(apiKey)}&instanceId=${encodeURIComponent(instanceId)}`;
}

/**
 * Poll for the session file at `{cwd}/.claude/.cc2cc-session-id`.
 * Tries every `intervalMs` for up to `timeoutMs`, returning the trimmed
 * contents on success or `null` if the file never appears / is empty.
 */
async function pollSessionFile(timeoutMs = 2000, intervalMs = 100): Promise<string | null> {
  const sessionFile = path.join(process.cwd(), ".claude", ".cc2cc-session-id");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const content = fs.readFileSync(sessionFile, "utf-8").trim();
      if (content) return content;
    } catch {
      // File doesn't exist yet — keep polling
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}

/**
 * Load and validate plugin configuration from environment variables.
 * Polls for the session file for up to 2 seconds; falls back to a random UUIDv4
 * if the file is not found.
 *
 * @throws {Error} If CC2CC_HUB_URL or CC2CC_API_KEY are not set.
 */
/**
 * Read an env var, returning undefined if it is unset OR if it contains an
 * unexpanded placeholder (e.g. "${CC2CC_PROJECT}") emitted by the plugin
 * system when the variable is not present in the user's environment.
 */
function env(name: string): string | undefined {
  const v = process.env[name];
  if (!v || /^\$\{[^}]+\}$/.test(v)) return undefined;
  return v;
}

export async function loadConfig(): Promise<PluginConfig> {
  const hubUrl = env("CC2CC_HUB_URL");
  if (!hubUrl) {
    throw new Error("Missing required env var CC2CC_HUB_URL (e.g. ws://192.168.1.10:3100)");
  }

  const apiKey = env("CC2CC_API_KEY");
  if (!apiKey) {
    throw new Error("Missing required env var CC2CC_API_KEY (must match hub CC2CC_HUB_API_KEY)");
  }

  const username = env("CC2CC_USERNAME") || process.env.USER || process.env.LOGNAME || "unknown";

  const host = env("CC2CC_HOST") || process.env.HOSTNAME || "unknown-host";

  const project = env("CC2CC_PROJECT") || basename(process.cwd());

  // Prefer explicit env var (used by cctmux team mode to avoid shared-file races),
  // then poll for the session file written by the SessionStart hook, then fall back to UUID
  const sessionId = env("CC2CC_SESSION_ID") || ((await pollSessionFile()) ?? randomUUID());

  const base = { hubUrl, apiKey, username, host, project };
  const instanceId = buildInstanceId(base, sessionId);
  const wsUrl = buildWsUrl(hubUrl, apiKey, instanceId);

  return { ...base, sessionId, instanceId, wsUrl };
}
