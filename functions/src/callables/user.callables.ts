import {createUserProfileSchema} from "../schemas/user.schema";
import * as userService from "../services/user.service";
import {callable} from "../utils/callable";

export const createUserProfile = callable(
  "createUserProfile",
  createUserProfileSchema,
  (identity, data) =>
    userService.ensureUserProfile(identity, data.displayName ?? null),
);
