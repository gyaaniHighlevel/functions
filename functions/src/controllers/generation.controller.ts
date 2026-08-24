import type {Request, Response} from "express";
import {generateRequestSchema} from "../schemas/generation.schema";
import {runGeneration} from "../services/generation.service";
import {SseWriter} from "../lib/sse";

/**
 * POST /generate — SSE streaming generation endpoint (LLD §7).
 *
 * This controller validates the request, opens an SSE stream, and hands off
 * to the generation service. The service owns the entire stream lifecycle
 * and always terminates with exactly one `done` or `error` event (INV-6).
 */
export async function generate(req: Request, res: Response) {
  const uid = res.locals.identity?.uid;
  if (!uid) {
    res.status(401).json({
      code: "UNAUTHENTICATED",
      message: "Sign in to continue.",
    });
    return;
  }

  // Validate request body before opening the SSE stream
  const parsed = generateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    res.status(422).json({
      code: "VALIDATION_FAILED",
      message: detail,
    });
    return;
  }

  const {projectId, prompt} = parsed.data;

  // Open SSE stream — from here on, errors go through the SSE channel
  const sse = new SseWriter(res);

  await runGeneration(uid, projectId, prompt, sse);
}
