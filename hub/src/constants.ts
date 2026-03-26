// hub/src/constants.ts

/**
 * WebSocket.OPEN numeric value (= 1).
 * The WebSocket global is not available in the Bun server context, so we
 * define the constant here and import it wherever a readyState comparison is needed.
 */
export const WS_OPEN = 1;
