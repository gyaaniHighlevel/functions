import type {NextFunction, Request, RequestHandler, Response} from "express";

/** Express 4 does not catch rejected promises — route every rejection
 * into next(), where the error handler picks it up. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) =>
    Promise<unknown>): RequestHandler =>
    (req, res, next) => {
      fn(req, res, next).catch(next);
    };
