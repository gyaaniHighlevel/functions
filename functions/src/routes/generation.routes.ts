import {Router} from "express";
import {asyncHandler} from "../utils/async-handler";
import {generate} from "../controllers/generation.controller";

export const generationRoutes = Router();

/** POST /generate — SSE streaming generation (LLD §7). */
generationRoutes.post("/", asyncHandler(generate));
