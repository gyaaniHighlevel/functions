/**
 * Validation gates for generated files (LLD §7.6).
 *
 * Per file, at file_end:
 * 1. Path in allowed set (already guaranteed by parser; asserted again).
 * 2. size ≤ 100_000 bytes.
 * 3. action='delete' only for styles.css.
 * 4. app.js: acorn.parse — must be valid JS.
 * 5. index.html: must contain id="app"; must NOT contain <script.
 * 6. styles.css: size only.
 */

import * as acorn from "acorn";
import {ALLOWED_PATHS, FilePath} from "../models/project.model";
import {FileAction} from "./parser";
import {byteSize} from "../utils/ids";

const MAX_FILE_SIZE = 100_000;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateFile(
  path: FilePath,
  action: FileAction,
  content: string,
): ValidationResult {
  // Gate 1: path in allowed set
  if (!ALLOWED_PATHS.has(path)) {
    return {valid: false, error: `Invalid path: ${path}`};
  }

  // Gate 3: delete only for styles.css
  if (action === "delete") {
    if (path !== "styles.css") {
      return {
        valid: false,
        error: `Cannot delete required file: ${path}`,
      };
    }
    return {valid: true};
  }

  // Gate 2: size check
  const size = byteSize(content);
  if (size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `${path} exceeds 100KB limit (${size} bytes).`,
    };
  }

  // Gate 4: app.js — acorn syntax validation
  if (path === "app.js") {
    try {
      acorn.parse(content, {
        ecmaVersion: "latest",
        sourceType: "module",
      });
    } catch (err) {
      const msg = err instanceof SyntaxError ? err.message : String(err);
      return {
        valid: false,
        error: `app.js has a syntax error: ${msg}`,
      };
    }
  }

  // Gate 5: index.html — must have id="app", must not have <script
  if (path === "index.html") {
    if (!content.includes('id="app"')) {
      return {
        valid: false,
        error: 'index.html must contain an element with id="app".',
      };
    }
    if (/<script/i.test(content)) {
      return {
        valid: false,
        error: "index.html must not contain <script> tags.",
      };
    }
  }

  // Gate 6: styles.css — size only (already checked above)

  return {valid: true};
}
