// plugin/src/session-watcher.ts
import fs from "node:fs";
import path from "node:path";
import { buildInstanceId, buildWsUrl } from "./config.js";
import { HubConnection } from "./connection.js";
import { createTools } from "./tools.js";
import type { PluginConfig } from "./config.js";
import type { PluginTools } from "./tools.js";

export interface SessionWatcherState {
  conn: HubConnection;
  tools: PluginTools;
}

export interface SessionWatcherCallbacks {
  /** Called when connection/tools are replaced — wire handlers onto the new conn. */
  onReconnect: (newState: SessionWatcherState, oldConn: HubConnection) => void;
}

/**
 * Watch the Claude Code session-ID file for changes (fires on /clear).
 * When a new session ID is detected, notifies the hub via session_update,
 * updates the config in-place, and reconnects with the new identity.
 *
 * Uses fs.watchFile (poll-based, tolerates non-existent files).
 * Returns an unwatcher function that should be called on graceful shutdown.
 */
export function watchSession(
  config: PluginConfig,
  state: SessionWatcherState,
  callbacks: SessionWatcherCallbacks,
): () => void {
  const sessionFile = path.join(process.cwd(), ".claude", ".cc2cc-session-id");
  let currentSessionId = config.sessionId;
  let active = false;

  const handler = async () => {
    if (active) return; // debounce concurrent file events
    active = true;
    try {
      let newSessionId: string;
      try {
        newSessionId = fs.readFileSync(sessionFile, "utf-8").trim();
      } catch {
        return; // file not yet created or temporarily unreadable
      }
      if (!newSessionId || newSessionId === currentSessionId) return;

      const newInstanceId = buildInstanceId(config, newSessionId);

      // Notify hub: migrate queue and re-register
      await state.conn.request("session_update", { newInstanceId });

      // Update config in-place so tools use the new identity
      const oldInstanceId = config.instanceId;
      config.instanceId = newInstanceId;
      config.wsUrl = buildWsUrl(config.hubUrl, config.apiKey, newInstanceId);
      config.sessionId = newSessionId;
      currentSessionId = newSessionId;

      process.stderr.write(`[cc2cc] session updated: ${oldInstanceId} → ${newInstanceId}\n`);

      // Replace connection and tools; let caller wire handlers and connect
      const oldConn = state.conn;
      state.conn = new HubConnection(config.wsUrl);
      state.tools = createTools(config, state.conn);
      state.conn.connect();
      callbacks.onReconnect(state, oldConn);
      oldConn.destroy();
    } catch (err) {
      process.stderr.write(`[cc2cc] session update error: ${(err as Error).message}\n`);
    } finally {
      active = false;
    }
  };

  fs.watchFile(sessionFile, { interval: 2000, persistent: false }, handler);

  return () => {
    fs.unwatchFile(sessionFile, handler);
  };
}
