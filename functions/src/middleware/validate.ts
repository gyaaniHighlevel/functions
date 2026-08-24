import type {RequestHandler} from "express";
import type {ZodSchema} from "zod";
import {AppError} from "../utils/app-error";

/** Validates and replaces req.body — downstream code only ever sees
 * parsed, trimmed, defaulted input in exactly the schema's shape. */
export const validateBody =
  (schema: ZodSchema): RequestHandler =>
    (req, _res, next) => {
      const result = schema.safeParse(req.body ?? {});
      if (!result.success) {
        const detail = result.error.issues
          .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
          .join("; ");
        next(AppError.validation(detail));
        return;
      }
      req.body = result.data;
      next();
    };
