import {CallableFunction, onCall} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {z} from "zod";
import {AppError, toCallableError} from "./app-error";
import {Identity, identityFromToken} from "./identity";

type Handler<S extends z.ZodTypeAny, R> =
  (identity: Identity, data: z.output<S>) => Promise<R>;

/** Shared onCall wrapper: auth, strict validation, logging, and
 * AppError → HttpsError mapping live here once, not in every callable. */
export function callable<S extends z.ZodTypeAny, R>(
  name: string,
  schema: S,
  handler: Handler<S, R>,
): CallableFunction<unknown, Promise<R>> {
  return onCall(async (request) => {
    let uid = "unknown";
    try {
      if (!request.auth) {
        throw AppError.unauthenticated();
      }
      const identity = identityFromToken(request.auth.token);
      uid = identity.uid;

      const parsed = schema.safeParse(request.data ?? {});
      if (!parsed.success) {
        throw AppError.validation(
          parsed.error.issues[0]?.message ?? "Invalid request.");
      }

      const result = await handler(identity, parsed.data);
      logger.info(`${name} succeeded`, {uid});
      return result;
    } catch (err) {
      if (err instanceof AppError) {
        logger.error(`${name} rejected`, {uid, ...err.toJSON()});
      } else {
        logger.error(`${name} failed`, {uid, error: String(err)});
      }
      throw toCallableError(err);
    }
  });
}
