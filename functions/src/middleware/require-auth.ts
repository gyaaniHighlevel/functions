import {getAuth} from "firebase-admin/auth";
import type {RequestHandler} from "express";
import {AppError} from "../utils/app-error";
import {identityFromToken} from "../utils/identity";

/** After this runs, downstream handlers can trust res.locals.identity. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    next(AppError.unauthenticated());
    return;
  }
  try {
    const decoded = await getAuth().verifyIdToken(token);
    res.locals.identity = identityFromToken(decoded);
    next();
  } catch {
    next(AppError.unauthenticated("Session expired. Sign in again."));
  }
};
