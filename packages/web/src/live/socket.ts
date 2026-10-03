export interface Push {
  type: string;
  payload: unknown;
}

type Handler = (msg: Push) => void;

const handlers = new Set<Handler>();
const connectHandlers = new Set<() => void>();
const connectionHandlers = new Set<(open: boolean) => void>();
let socket: WebSocket | undefined;
let retry = 0;

/**
 * One shared connection to the daemon's `/ws`. Reconnects with backoff; `onReconnect` handlers
 * run after every reconnect so views can reload what they may have missed, and
 * `onConnection` handlers hear every open and close.
 */
function connect(): void {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => {
    for (const h of connectionHandlers) h(true);
    if (retry > 0) for (const h of connectHandlers) h();
    retry = 0;
  };
  ws.onmessage = (e) => {
    let msg: Push;
    try {
      msg = JSON.parse(String(e.data)) as Push;
    } catch {
      return;
    }
    for (const h of handlers) h(msg);
  };
  ws.onclose = () => {
    socket = undefined;
    for (const h of connectionHandlers) h(false);
    retry++;
    setTimeout(connect, Math.min(1000 * 2 ** (retry - 1), 15_000));
  };
}

export function onPush(handler: Handler): () => void {
  if (!socket) connect();
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function onReconnect(handler: () => void): () => void {
  connectHandlers.add(handler);
  return () => connectHandlers.delete(handler);
}

export function onConnection(handler: (open: boolean) => void): () => void {
  connectionHandlers.add(handler);
  return () => connectionHandlers.delete(handler);
}
