/**
 * Streaming tag parser (LLD §7.5).
 *
 * Pure module, no I/O: `feed(delta) → ParserEvent[]`, `finish() → ParserEvent[]`.
 * Extracts `<file path="P" action="A">…</file>` blocks from the LLM stream.
 *
 * Holdback: in each state the parser withholds the longest buffer suffix that
 * is a proper prefix of the next marker (`<file` in TEXT, `</file>` in IN_FILE)
 * and emits the rest. A marker split across deltas is reassembled invisibly.
 */

import {ALLOWED_PATHS, FilePath} from "../models/project.model";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type FileAction = "create" | "update" | "delete";

export interface TextEvent {
  type: "text";
  text: string;
}

export interface FileStartEvent {
  type: "file_start";
  path: FilePath;
  action: FileAction;
}

export interface FileDeltaEvent {
  type: "file_delta";
  path: FilePath;
  delta: string;
}

export interface FileEndEvent {
  type: "file_end";
  path: FilePath;
  content: string;
}

export interface ParseErrorEvent {
  type: "parse_error";
  code: "MALFORMED_OUTPUT" | "UNCLOSED_FILE";
  message: string;
  path?: FilePath;
}

export type ParserEvent =
  | TextEvent
  | FileStartEvent
  | FileDeltaEvent
  | FileEndEvent
  | ParseErrorEvent;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

type State = "TEXT" | "IN_TAG" | "IN_FILE";

const OPEN_PREFIX = "<file";
const CLOSE_TAG = "</file>";
const MAX_TAG_LEN = 256;

const VALID_ACTIONS = new Set<string>(["create", "update", "delete"]);

/**
 * Parse attributes from a `<file path="..." action="...">` open tag.
 * Returns `{path, action}` or throws with a descriptive message.
 */
function parseAttributes(
  tagText: string,
): {path: FilePath; action: FileAction} {
  const pathMatch = tagText.match(/path\s*=\s*"([^"]*)"/);
  const actionMatch = tagText.match(/action\s*=\s*"([^"]*)"/);

  if (!pathMatch) {
    throw new Error("Missing path attribute in <file> tag.");
  }
  if (!actionMatch) {
    throw new Error("Missing action attribute in <file> tag.");
  }

  const path = pathMatch[1];
  const action = actionMatch[1];

  if (!ALLOWED_PATHS.has(path)) {
    throw new Error(
      `Invalid file path "${path}". Allowed: index.html, app.js, styles.css.`);
  }
  if (!VALID_ACTIONS.has(action)) {
    throw new Error(
      `Invalid action "${action}". Allowed: create, update, delete.`);
  }

  return {path: path as FilePath, action: action as FileAction};
}

/**
 * Strip one leading newline after open tag and one trailing newline before
 * close tag so files don't accumulate blank first/last lines across turns.
 */
function trimContent(content: string): string {
  let s = content;
  if (s.startsWith("\n")) s = s.slice(1);
  if (s.endsWith("\n")) s = s.slice(0, -1);
  return s;
}

/**
 * Strip markdown fences wrapping the whole output (```).
 * A known failure mode of models under formatting pressure.
 */
export function stripMarkdownFences(text: string): string {
  return text.replace(/^```[a-z]*\n?/gm, "").replace(/\n?```$/gm, "");
}

export class StreamingTagParser {
  private state: State = "TEXT";
  private buffer = "";
  private currentPath: FilePath | null = null;
  private fileContent = "";
  private firstDelta = true;
  /** Track duplicate paths — last block wins. */
  private stagedPaths = new Set<string>();

  /**
   * Feed a text delta from the LLM stream. Returns events to emit.
   */
  feed(delta: string): ParserEvent[] {
    // Strip markdown fences on the very first delta batch
    if (this.firstDelta) {
      this.firstDelta = false;
      delta = stripMarkdownFences(delta);
    }

    this.buffer += delta;
    const events: ParserEvent[] = [];

    let safety = 0;
    while (this.buffer.length > 0 && safety++ < 10000) {
      const before = this.buffer.length;

      if (this.state === "TEXT") {
        this.consumeText(events);
      } else if (this.state === "IN_TAG") {
        this.consumeTag(events);
      } else {
        this.consumeFile(events);
      }

      // No progress — need more data
      if (this.buffer.length === before) break;
    }

    return events;
  }

  /**
   * Signal end of LLM stream. Returns final events.
   */
  finish(): ParserEvent[] {
    const events: ParserEvent[] = [];

    if (this.state === "IN_TAG") {
      // Incomplete tag at end of stream
      events.push({
        type: "parse_error",
        code: "MALFORMED_OUTPUT",
        message: "Stream ended inside an incomplete <file> tag.",
      });
    } else if (this.state === "IN_FILE") {
      // Unclosed file — model got truncated
      events.push({
        type: "parse_error",
        code: "UNCLOSED_FILE",
        message: `Stream ended with unclosed file: ${this.currentPath}`,
        path: this.currentPath ?? undefined,
      });
    } else if (this.buffer.length > 0) {
      // Flush remaining text
      events.push({type: "text", text: this.buffer});
      this.buffer = "";
    }

    return events;
  }

  // -------------------------------------------------------------------------
  // State handlers
  // -------------------------------------------------------------------------

  private consumeText(events: ParserEvent[]): void {
    const idx = this.buffer.indexOf("<file");
    if (idx === -1) {
      // Check if buffer ends with a prefix of "<file"
      const holdback = longestPrefixSuffix(this.buffer, OPEN_PREFIX);
      if (holdback > 0) {
        const emit = this.buffer.slice(0, this.buffer.length - holdback);
        if (emit) events.push({type: "text", text: emit});
        this.buffer = this.buffer.slice(this.buffer.length - holdback);
      } else {
        if (this.buffer) events.push({type: "text", text: this.buffer});
        this.buffer = "";
      }
      return;
    }

    // Emit text before the tag
    if (idx > 0) {
      events.push({type: "text", text: this.buffer.slice(0, idx)});
    }
    this.buffer = this.buffer.slice(idx);
    this.state = "IN_TAG";
  }

  private consumeTag(events: ParserEvent[]): void {
    // Wait for the closing `>` of the open tag
    const closeIdx = this.buffer.indexOf(">");
    if (closeIdx === -1) {
      if (this.buffer.length > MAX_TAG_LEN) {
        events.push({
          type: "parse_error",
          code: "MALFORMED_OUTPUT",
          message: "Open <file> tag exceeded 256 chars without closing.",
        });
        this.state = "TEXT";
        this.buffer = "";
      }
      return;
    }

    const fullTag = this.buffer.slice(0, closeIdx + 1);
    this.buffer = this.buffer.slice(closeIdx + 1);

    // Self-closing tag? <file path="..." action="delete"/>
    const isSelfClosing = fullTag.endsWith("/>");

    let attrs: {path: FilePath; action: FileAction};
    try {
      attrs = parseAttributes(fullTag);
    } catch (err) {
      events.push({
        type: "parse_error",
        code: "MALFORMED_OUTPUT",
        message: (err as Error).message,
      });
      this.state = "TEXT";
      return;
    }

    // Duplicate path detection — warn and reset (last block wins)
    if (this.stagedPaths.has(attrs.path)) {
      // Previous block for this path will be overwritten
    }
    this.stagedPaths.add(attrs.path);

    if (isSelfClosing || attrs.action === "delete") {
      // Delete or self-closing: emit start + end with empty content
      events.push({
        type: "file_start",
        path: attrs.path,
        action: attrs.action,
      });
      events.push({
        type: "file_end",
        path: attrs.path,
        content: "",
      });
      this.state = "TEXT";
    } else {
      this.currentPath = attrs.path;
      this.fileContent = "";
      events.push({
        type: "file_start",
        path: attrs.path,
        action: attrs.action,
      });
      this.state = "IN_FILE";
    }
  }

  private consumeFile(events: ParserEvent[]): void {
    const closeIdx = this.buffer.indexOf(CLOSE_TAG);
    if (closeIdx === -1) {
      // Check holdback for partial </file> at end
      const holdback = longestPrefixSuffix(this.buffer, CLOSE_TAG);
      if (holdback > 0) {
        const emit = this.buffer.slice(0, this.buffer.length - holdback);
        if (emit) {
          this.fileContent += emit;
          events.push({
            type: "file_delta",
            path: this.currentPath!,
            delta: emit,
          });
        }
        this.buffer = this.buffer.slice(this.buffer.length - holdback);
      } else {
        if (this.buffer) {
          this.fileContent += this.buffer;
          events.push({
            type: "file_delta",
            path: this.currentPath!,
            delta: this.buffer,
          });
        }
        this.buffer = "";
      }
      return;
    }

    // Found the close tag
    const beforeClose = this.buffer.slice(0, closeIdx);
    if (beforeClose) {
      this.fileContent += beforeClose;
      events.push({
        type: "file_delta",
        path: this.currentPath!,
        delta: beforeClose,
      });
    }

    const trimmed = trimContent(this.fileContent);
    events.push({
      type: "file_end",
      path: this.currentPath!,
      content: trimmed,
    });

    this.buffer = this.buffer.slice(closeIdx + CLOSE_TAG.length);
    this.currentPath = null;
    this.fileContent = "";
    this.state = "TEXT";
  }
}

// ---------------------------------------------------------------------------
// Holdback helper
// ---------------------------------------------------------------------------

/**
 * Returns the length of the longest suffix of `text` that is a proper prefix
 * of `marker`. E.g. text="abc<fi", marker="<file" → 3 (the "<fi" suffix).
 */
function longestPrefixSuffix(text: string, marker: string): number {
  const maxCheck = Math.min(text.length, marker.length - 1);
  for (let len = maxCheck; len >= 1; len--) {
    if (text.endsWith(marker.slice(0, len))) {
      return len;
    }
  }
  return 0;
}
