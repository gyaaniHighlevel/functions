import type {ErrorRequestHandler} from "express";
import * as logger from "firebase-functions/logger";
import {ZodError} from "zod";
import {AppError} from "../utils/app-error";

/** The single place errors become responses. Registered last in app.ts.
 * Non-2xx bodies follow the spec contract: {code, message, retryAfter?}. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const uid = res.locals.identity?.uid ?? "unknown";

  if (err instanceof AppError) {
    logger.error("Request rejected",
      {uid, path: req.path, ...err.toJSON()});
    if (err.retryAfter) {
      res.set("Retry-After", String(err.retryAfter));
    }
    res.status(err.status).json(err.toJSON());
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({
      code: "VALIDATION_FAILED",
      message: err.issues[0]?.message ?? "Invalid input.",
    });
    return;
  }
  logger.error("Unhandled error", {uid, path: req.path, error: String(err)});
  res.status(500).json({
    code: "INTERNAL",
    message: "Something went wrong. Try again.",
  });
};
