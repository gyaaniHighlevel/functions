/**
 * SSE framing + heartbeat helper (LLD §7.4).
 *
 * Headers: text/event-stream, no-cache, no-transform, X-Accel-Buffering: no.
 * Frame format: `event: <name>\ndata: <json>\n\n`.
 * Heartbeat: `: ping\n\n` every 15 s, cleared on stream end.
 */

import type {Response} from "express";

export class SseWriter {
  private closed = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly res: Response) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "Connection": "keep-alive",
    });
    res.flushHeaders();

    // Start heartbeat
    this.heartbeat = setInterval(() => {
      this.raw(": ping\n\n");
    }, 15_000);

    // Guard against writing to a dead socket
    res.on("close", () => {
      this.closed = true;
      this.clearHeartbeat();
    });
  }

  /** Send a named SSE event with JSON data. */
  send(event: string, data: Record<string, unknown>): void {
    this.raw(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /** End the stream. */
  end(): void {
    this.clearHeartbeat();
    if (!this.closed) {
      this.closed = true;
      this.res.end();
    }
  }

  /** Whether the client has disconnected. */
  get isClientGone(): boolean {
    return this.closed;
  }

  private raw(data: string): void {
    if (this.closed) return;
    try {
      this.res.write(data);
    } catch {
      this.closed = true;
      this.clearHeartbeat();
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
