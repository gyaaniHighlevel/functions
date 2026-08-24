import {FunctionsErrorCode, HttpsError} from "firebase-functions/v2/https";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "HL_NOT_CONNECTED"
  | "GENERATION_IN_FLIGHT"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "HL_RATE_LIMITED"
  | "HL_UPSTREAM_ERROR"
  | "LLM_OVERLOADED"
  | "LLM_STREAM_ERROR"
  | "MALFORMED_OUTPUT"
  | "GENERATION_TIMEOUT"
  | "PERSISTENCE_FAILED"
  | "ORPHANED";

/** Operational error: expected, safe to serialize to the client. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "AppError";
  }

  toJSON(): {code: ErrorCode; message: string; retryAfter?: number} {
    return {
      code: this.code,
      message: this.message,
      ...(this.retryAfter ? {retryAfter: this.retryAfter} : {}),
    };
  }

  static unauthenticated = (msg = "Sign in to continue.") =>
    new AppError(401, "UNAUTHENTICATED", msg);
  static forbidden = (msg: string) => new AppError(403, "FORBIDDEN", msg);
  static notFound = (msg: string) => new AppError(404, "NOT_FOUND", msg);
  static validation = (msg: string) =>
    new AppError(422, "VALIDATION_FAILED", msg);
  static hlNotConnected = (
    msg = "HighLevel is not connected. Connect your account first.") =>
    new AppError(409, "HL_NOT_CONNECTED", msg);
  static hlUpstream = (msg: string) =>
    new AppError(502, "HL_UPSTREAM_ERROR", msg);
  static hlRateLimited = (msg: string, retryAfter?: number) =>
    new AppError(429, "HL_RATE_LIMITED", msg, retryAfter);
}

const CALLABLE_CODE_BY_STATUS: Record<number, FunctionsErrorCode> = {
  400: "invalid-argument",
  401: "unauthenticated",
  403: "permission-denied",
  404: "not-found",
  409: "failed-precondition",
  422: "invalid-argument",
  429: "resource-exhausted",
  502: "unavailable",
};

export function toCallableError(err: unknown): HttpsError {
  if (err instanceof AppError) {
    const code = CALLABLE_CODE_BY_STATUS[err.status] ?? "internal";
    return new HttpsError(code, err.message, err.toJSON());
  }
  return new HttpsError("internal", "Something went wrong. Try again.");
}
