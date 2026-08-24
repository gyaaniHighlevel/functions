import {Router} from "express";
import * as controller from "../controllers/oauth.controller";
import {validateBody} from "../middleware/validate";
import {
  exchangeCodeSchema,
  refreshAccessTokenSchema,
} from "../schemas/oauth.schema";
import {asyncHandler} from "../utils/async-handler";

export const oauthRoutes = Router();

oauthRoutes.post("/connect",
  validateBody(exchangeCodeSchema), asyncHandler(controller.connect));
oauthRoutes.post("/token",
  validateBody(refreshAccessTokenSchema), asyncHandler(controller.token));
oauthRoutes.get("/status", asyncHandler(controller.status));
