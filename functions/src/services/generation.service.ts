/**
 * Generation orchestrator (LLD §7).
 *
 * POST /generate — streaming SSE response.
 * 1. Auth, project ownership, single-flight lock.
 * 2. Context assembly (blocks A–C static, E working tree, F chat history, G prompt).
 * 3. Stream Anthropic response, parse file blocks, validate, emit SSE.
 * 4. Commit: blobs + snapshot + file docs + generation doc + message.
 */

import Anthropic from "@anthropic-ai/sdk";
import * as logger from "firebase-functions/logger";
import {FieldValue} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {
  FileDoc,
  FilePath,
  blobRef,
  fileRef,
  filesCol,
  projectRef,
} from "../models/project.model";
import {
  SnapshotManifestEntry,
  snapshotRef,
} from "../models/snapshot.model";
import {GenerationDoc} from "../models/system.model";
import {generationRef, messageRef} from "../models/generation.model";
import {SYSTEM_PROMPT} from "../templates/system-prompt";
import {
  StreamingTagParser,
  FileAction,
  ParserEvent,
} from "../lib/parser";
import {validateFile} from "../lib/validate-files";
import {SseWriter} from "../lib/sse";
import {AppError} from "../utils/app-error";
import {newId, sha256hex, byteSize} from "../utils/ids";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 12_288;
const TEMPERATURE = 0.3;
const INTERNAL_DEADLINE_MS = 480_000; // 480 s, reserve 60 s for commit
const MAX_HISTORY_TURNS = 8;
const MAX_RAW_PARTIAL = 200_000;
const ALREADY_EXISTS = 6; // Firestore error code

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StagedFile {
  path: FilePath;
  action: FileAction;
  content: string;
  sha256: string;
  size: number;
}

interface BaseTree {
  files: Map<FilePath, FileDoc>;
  manifest: SnapshotManifestEntry[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a generation turn. Streams SSE events to the client.
 * This function handles its own errors and always terminates the SSE stream.
 */
export async function runGeneration(
  uid: string,
  projectId: string,
  prompt: string,
  sse: SseWriter,
): Promise<void> {
  let generationId: string | null = null;
  let rawAccumulator = "";

  try {
    // 1. Load project + ownership + active check
    const projSnap = await projectRef(projectId).get();
    const project = projSnap.data();
    if (!projSnap.exists || !project) {
      throw AppError.notFound("Project not found.");
    }
    if (project.ownerUid !== uid) {
      throw AppError.forbidden("You do not own this project.");
    }
    if (project.status !== "active") {
      throw AppError.notFound("Project has been deleted.");
    }

    // 2. Single-flight lock via transaction (INV-3)
    generationId = newId();
    await db.runTransaction(async (tx) => {
      const projDoc = await tx.get(projectRef(projectId));
      const proj = projDoc.data()!;

      if (proj.activeGenerationId) {
        // Check if it's an orphan (older than 600s)
        const genDoc = await tx.get(
          generationRef(projectId, proj.activeGenerationId));
        const gen = genDoc.data();
        if (gen && gen.status === "streaming") {
          const startedMs = gen.startedAt?.toMillis?.() ?? 0;
          if (Date.now() - startedMs < 600_000) {
            throw new AppError(
              409, "GENERATION_IN_FLIGHT",
              "A generation is already running for this project.");
          }
          // Orphan — mark failed
          tx.update(genDoc.ref, {
            status: "failed",
            completedAt: FieldValue.serverTimestamp(),
            error: {code: "ORPHANED", message: "Previous generation timed out."},
          } as unknown as Partial<GenerationDoc>);
        }
      }

      // Set new generation as active
      tx.update(projDoc.ref, {
        activeGenerationId: generationId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Create generation doc
      tx.set(generationRef(projectId, generationId!), {
        ownerUid: uid,
        status: "streaming",
        prompt,
        model: MODEL,
        startedAt: FieldValue.serverTimestamp(),
        completedAt: null,
        usage: null,
        snapshotId: null,
        filesChanged: [],
        error: null,
        rawPartial: null,
      } as unknown as GenerationDoc);
    });

    // 3. Write user message
    const userMessageId = newId();
    await messageRef(projectId, userMessageId).set({
      ownerUid: uid,
      role: "user",
      content: prompt,
      filesChanged: [],
      generationId,
      createdAt: FieldValue.serverTimestamp(),
    });

    // 4. Emit meta SSE event
    sse.send("meta", {generationId, model: MODEL});

    // 5. Read base tree (block E)
    const baseTree = await readBaseTree(projectId);

    // 6. Read chat history (block F)
    const history = await readChatHistory(projectId);

    // 7. Assemble messages and call Anthropic
    const anthropic = new Anthropic();
    const deadline = Date.now() + INTERNAL_DEADLINE_MS;
    const abortController = new AbortController();

    // Deadline timer
    const deadlineTimer = setTimeout(() => {
      abortController.abort();
    }, INTERNAL_DEADLINE_MS);

    const messages = buildMessages(baseTree, history, prompt);

    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: [
        {
          type: "text" as const,
          text: SYSTEM_PROMPT,
          cache_control: {type: "ephemeral" as const},
        },
      ],
      messages,
    }, {signal: abortController.signal});

    // 8. Stream + parse
    const parser = new StreamingTagParser();
    const staged = new Map<FilePath, StagedFile>();
    let narration = "";
    let validationError: string | null = null;

    try {
      for await (const event of stream) {
        if (sse.isClientGone) {
          // Client disconnected — continue to completion (§7.9)
        }

        if (event.type === "content_block_delta" &&
            event.delta.type === "text_delta") {
          const delta = event.delta.text;
          rawAccumulator += delta;

          // Safety cap on raw output
          if (rawAccumulator.length > MAX_RAW_PARTIAL * 2) {
            abortController.abort();
            break;
          }

          const parserEvents = parser.feed(delta);
          for (const pe of parserEvents) {
            processParserEvent(
              pe, sse, staged, narration,
              (n) => {
                narration = n;
              },
              (err) => {
                validationError = err;
              },
            );
            if (validationError) {
              abortController.abort();
              break;
            }
          }
          if (validationError) break;
        }
      }

      // Finish parser
      if (!validationError) {
        const finalEvents = parser.finish();
        for (const pe of finalEvents) {
          processParserEvent(
            pe, sse, staged, narration,
            (n) => {
              narration = n;
            },
            (err) => {
              validationError = err;
            },
          );
          if (validationError) break;
        }
      }
    } catch (err) {
      if (abortController.signal.aborted && Date.now() >= deadline) {
        validationError = "GENERATION_TIMEOUT";
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("Anthropic stream error", {uid, projectId, error: msg});
        validationError = `LLM_STREAM_ERROR: ${msg}`;
      }
    } finally {
      clearTimeout(deadlineTimer);
    }

    // Get usage from the stream's final message
    let usage: GenerationDoc["usage"] = null;
    try {
      const finalMessage = await stream.finalMessage();
      usage = {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
        cacheReadTokens:
          (finalMessage.usage as unknown as Record<string, number>)
            .cache_read_input_tokens ?? 0,
      };
    } catch {
      // Usage unavailable on abort
    }

    // 9. Handle failure
    if (validationError) {
      const errorCode = validationError.startsWith("GENERATION_TIMEOUT") ?
        "GENERATION_TIMEOUT" :
        validationError.startsWith("LLM_STREAM_ERROR") ?
          "LLM_STREAM_ERROR" :
          "MALFORMED_OUTPUT";

      await failGeneration(
        projectId, generationId!, errorCode, validationError,
        rawAccumulator, usage,
      );

      sse.send("error", {
        code: errorCode,
        message: validationError,
        partialPreserved: rawAccumulator.length > 0,
      });
      sse.end();
      return;
    }

    // 10. Commit
    if (staged.size === 0) {
      // Text-only turn — no snapshot, just save narration
      await commitTextOnly(
        projectId, generationId!, uid, narration, usage,
      );
      sse.send("done", {
        snapshotId: null,
        files: [],
        usage,
      });
      sse.end();
      return;
    }

    // No-op detection: every staged sha matches base tree
    const isNoop = [...staged.values()].every((sf) => {
      const baseFile = baseTree.files.get(sf.path);
      return baseFile && baseFile.sha256 === sf.sha256;
    });

    if (isNoop) {
      await commitTextOnly(
        projectId, generationId!, uid,
        narration || "No changes needed.", usage,
      );
      sse.send("done", {snapshotId: null, files: [], usage});
      sse.end();
      return;
    }

    const result = await commitGeneration(
      projectId, generationId!, uid, baseTree, staged, narration, usage,
    );

    sse.send("done", {
      snapshotId: result.snapshotId,
      files: result.manifest.map((f) => ({path: f.path, sha256: f.sha256})),
      usage,
    });
    sse.end();
  } catch (err) {
    logger.error("Generation failed", {
      uid, projectId, generationId, error: String(err),
    });

    const appErr = err instanceof AppError ? err : null;
    const code = appErr?.code ?? "PERSISTENCE_FAILED";
    const message = appErr?.message ?? "Something went wrong. Try again.";

    // Try to update generation doc on failure
    if (generationId) {
      try {
        await failGeneration(
          projectId, generationId, code, message, rawAccumulator, null,
        );
      } catch (innerErr) {
        logger.error("Failed to update generation doc on error", {
          generationId, error: String(innerErr),
        });
      }
    }

    sse.send("error", {
      code,
      message,
      partialPreserved: false,
    });
    sse.end();
  }
}

// ---------------------------------------------------------------------------
// Context assembly
// ---------------------------------------------------------------------------

async function readBaseTree(projectId: string): Promise<BaseTree> {
  const snap = await filesCol(projectId).get();
  const files = new Map<FilePath, FileDoc>();
  const manifest: SnapshotManifestEntry[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    files.set(data.path, data);
    manifest.push({path: data.path, sha256: data.sha256, size: data.size});
  }

  return {files, manifest};
}

async function readChatHistory(
  projectId: string,
): Promise<Array<{role: "user" | "assistant"; content: string}>> {
  const snap = await db.collection(`projects/${projectId}/messages`)
    .orderBy("createdAt", "desc")
    .limit(MAX_HISTORY_TURNS * 2) // fetch more, will pair
    .get();

  const messages: Array<{role: "user" | "assistant"; content: string}> = [];
  const docs = snap.docs.reverse(); // oldest first

  for (const doc of docs) {
    const data = doc.data();
    const role = data.role as "user" | "assistant";
    let content = data.content as string;

    // For assistant messages, append filesChanged info
    if (role === "assistant" && data.filesChanged?.length) {
      content += ` [updated ${(data.filesChanged as string[]).join(", ")}]`;
    }

    messages.push({role, content});
  }

  // Take last N turns
  return messages.slice(-MAX_HISTORY_TURNS * 2);
}

function buildMessages(
  baseTree: BaseTree,
  history: Array<{role: "user" | "assistant"; content: string}>,
  prompt: string,
): Anthropic.MessageParam[] {
  // Block E: current working tree
  let blockE = "## Current files\n\n";
  for (const [path, file] of baseTree.files) {
    blockE += `### ${path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
  }
  if (baseTree.files.size === 0) {
    blockE += "(No files yet — this is a fresh project.)\n";
  }

  // Block F: chat history
  const historyMessages: Anthropic.MessageParam[] = [];

  // Ensure conversation starts with a user message
  // We put blockE in the first user message
  if (history.length === 0) {
    // No history — just blockE + prompt
    historyMessages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: blockE,
          cache_control: {type: "ephemeral"},
        },
        {type: "text", text: prompt},
      ],
    });
  } else {
    // Prepend blockE to the conversation
    // First message must be user
    const firstHistoryMsg = history[0];
    if (firstHistoryMsg.role === "user") {
      historyMessages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: blockE,
            cache_control: {type: "ephemeral"},
          },
          {type: "text", text: firstHistoryMsg.content},
        ],
      });
      // Add rest of history
      for (let i = 1; i < history.length; i++) {
        historyMessages.push({
          role: history[i].role,
          content: history[i].content,
        });
      }
    } else {
      // History starts with assistant — insert a synthetic user message
      historyMessages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: blockE,
            cache_control: {type: "ephemeral"},
          },
        ],
      });
      for (const msg of history) {
        historyMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // Add the current prompt as the final user message
    historyMessages.push({
      role: "user",
      content: prompt,
    });
  }

  // Ensure alternating roles (Anthropic requires this)
  return mergeConsecutiveRoles(historyMessages);
}

/**
 * Anthropic requires strictly alternating user/assistant messages.
 * Merge consecutive same-role messages.
 */
function mergeConsecutiveRoles(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  const merged: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (merged.length > 0 &&
        merged[merged.length - 1].role === msg.role) {
      const last = merged[merged.length - 1];
      const lastContent = typeof last.content === "string" ?
        last.content :
        last.content.map((c) =>
          "text" in c ? c.text : "").join("\n");
      const newContent = typeof msg.content === "string" ?
        msg.content :
        (msg.content as Anthropic.TextBlockParam[]).map((c) =>
          "text" in c ? c.text : "").join("\n");
      merged[merged.length - 1] = {
        role: msg.role,
        content: lastContent + "\n\n" + newContent,
      };
    } else {
      merged.push(msg);
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Parser event processing
// ---------------------------------------------------------------------------

function processParserEvent(
  pe: ParserEvent,
  sse: SseWriter,
  staged: Map<FilePath, StagedFile>,
  narration: string,
  setNarration: (n: string) => void,
  setError: (err: string) => void,
): void {
  switch (pe.type) {
  case "text":
    setNarration(narration + pe.text);
    sse.send("text", {delta: pe.text});
    break;

  case "file_start":
    sse.send("file_start", {path: pe.path, action: pe.action});
    break;

  case "file_delta":
    sse.send("file_delta", {path: pe.path, delta: pe.delta});
    break;

  case "file_end": {
    const validation = validateFile(pe.path, "create", pe.content);
    if (!validation.valid) {
      setError(validation.error ?? "Validation failed.");
      return;
    }

    const sha = sha256hex(pe.content);
    const size = byteSize(pe.content);
    staged.set(pe.path, {
      path: pe.path,
      action: "create",
      content: pe.content,
      sha256: sha,
      size,
    });

    sse.send("file_end", {path: pe.path, sha256: sha, bytes: size});
    break;
  }

  case "parse_error":
    setError(pe.message);
    break;
  }
}

// ---------------------------------------------------------------------------
// Commit (§7.8)
// ---------------------------------------------------------------------------

async function writeBlobIfAbsent(
  projectId: string,
  uid: string,
  sha256: string,
  content: string,
  size: number,
): Promise<void> {
  try {
    await blobRef(projectId, sha256).create({
      ownerUid: uid,
      content,
      size,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    if ((err as {code?: number}).code === ALREADY_EXISTS) return;
    throw err;
  }
}

async function commitGeneration(
  projectId: string,
  generationId: string,
  uid: string,
  baseTree: BaseTree,
  staged: Map<FilePath, StagedFile>,
  narration: string,
  usage: GenerationDoc["usage"],
): Promise<{snapshotId: string; manifest: SnapshotManifestEntry[]}> {
  // 1. Write blobs
  await Promise.all(
    [...staged.values()].map((sf) =>
      writeBlobIfAbsent(projectId, uid, sf.sha256, sf.content, sf.size)),
  );

  // 2. Build new manifest: base tree overlaid with staged files
  const manifestMap = new Map<FilePath, SnapshotManifestEntry>();
  for (const entry of baseTree.manifest) {
    manifestMap.set(entry.path, entry);
  }
  for (const [path, sf] of staged) {
    if (sf.action === "delete") {
      manifestMap.delete(path);
    } else {
      manifestMap.set(path, {path, sha256: sf.sha256, size: sf.size});
    }
  }
  const manifest = [...manifestMap.values()];

  // 3. Build the batch
  const snapshotId = newId();
  const assistantMessageId = newId();
  const filesChanged = [...staged.keys()];
  const batch = db.batch();

  // Snapshot doc
  batch.set(snapshotRef(projectId, snapshotId), {
    ownerUid: uid,
    createdAt: FieldValue.serverTimestamp(),
    trigger: "generation",
    generationId,
    restoredFrom: null,
    label: null,
    files: manifest,
  });

  // File doc upserts/deletes
  for (const [path, sf] of staged) {
    if (sf.action === "delete") {
      batch.delete(fileRef(projectId, path));
    } else {
      batch.set(fileRef(projectId, path), {
        ownerUid: uid,
        path,
        content: sf.content,
        size: sf.size,
        sha256: sf.sha256,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: "llm",
      });
    }
  }

  // Project updates
  batch.update(projectRef(projectId), {
    headSnapshotId: snapshotId,
    activeGenerationId: null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Assistant message
  batch.set(messageRef(projectId, assistantMessageId), {
    ownerUid: uid,
    role: "assistant",
    content: (narration || "Updated the app.").slice(0, 4000),
    filesChanged,
    generationId,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Generation doc → completed
  batch.update(generationRef(projectId, generationId), {
    status: "completed",
    completedAt: FieldValue.serverTimestamp(),
    usage,
    snapshotId,
    filesChanged,
    error: null,
    rawPartial: null,
  } as unknown as Partial<GenerationDoc>);

  await batch.commit();
  logger.info("Generation committed", {
    uid, projectId, generationId, snapshotId, filesChanged,
  });

  return {snapshotId, manifest};
}

async function commitTextOnly(
  projectId: string,
  generationId: string,
  uid: string,
  narration: string,
  usage: GenerationDoc["usage"],
): Promise<void> {
  const assistantMessageId = newId();
  const batch = db.batch();

  batch.update(projectRef(projectId), {
    activeGenerationId: null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  batch.set(messageRef(projectId, assistantMessageId), {
    ownerUid: uid,
    role: "assistant",
    content: (narration || "No changes needed.").slice(0, 4000),
    filesChanged: [],
    generationId,
    createdAt: FieldValue.serverTimestamp(),
  });

  batch.update(generationRef(projectId, generationId), {
    status: "completed",
    completedAt: FieldValue.serverTimestamp(),
    usage,
    snapshotId: null,
    filesChanged: [],
    error: null,
    rawPartial: null,
  } as unknown as Partial<GenerationDoc>);

  await batch.commit();
  logger.info("Text-only generation committed", {
    uid, projectId, generationId,
  });
}

async function failGeneration(
  projectId: string,
  generationId: string,
  code: string,
  message: string,
  rawPartial: string,
  usage: GenerationDoc["usage"],
): Promise<void> {
  const batch = db.batch();

  batch.update(projectRef(projectId), {
    activeGenerationId: null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  batch.update(generationRef(projectId, generationId), {
    status: "failed",
    completedAt: FieldValue.serverTimestamp(),
    usage,
    error: {code, message},
    rawPartial: rawPartial.slice(0, MAX_RAW_PARTIAL),
  } as unknown as Partial<GenerationDoc>);

  await batch.commit();
  logger.error("Generation failed", {projectId, generationId, code, message});
}
