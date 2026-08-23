import {Router} from "express";
import * as controller from "../controllers/user.controller";
import {validateBody} from "../middleware/validate";
import {createUserProfileSchema} from "../schemas/user.schema";
import {asyncHandler} from "../utils/async-handler";

export const userRoutes = Router();

userRoutes.post("/profile",
  validateBody(createUserProfileSchema), asyncHandler(controller.createProfile));
userRoutes.get("/me", asyncHandler(controller.me));
