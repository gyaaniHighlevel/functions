import {Router} from "express";
import * as projects from "../controllers/project.controller";
import * as snapshots from "../controllers/snapshot.controller";
import {validateBody} from "../middleware/validate";
import {createProjectSchema, updateProjectSchema} from "../schemas/project.schema";
import {saveSnapshotBodySchema} from "../schemas/snapshot.schema";
import {asyncHandler} from "../utils/async-handler";

export const projectRoutes = Router();

projectRoutes.post("/",
  validateBody(createProjectSchema), asyncHandler(projects.create));
projectRoutes.get("/", asyncHandler(projects.list));
projectRoutes.get("/:projectId", asyncHandler(projects.get));
projectRoutes.patch("/:projectId",
  validateBody(updateProjectSchema), asyncHandler(projects.update));
projectRoutes.delete("/:projectId", asyncHandler(projects.softDelete));
projectRoutes.post("/:projectId/restore", asyncHandler(projects.restore));

projectRoutes.get("/:projectId/files", asyncHandler(projects.listFiles));

projectRoutes.get("/:projectId/snapshots", asyncHandler(snapshots.list));
projectRoutes.post("/:projectId/snapshots",
  validateBody(saveSnapshotBodySchema), asyncHandler(snapshots.save));
projectRoutes.post("/:projectId/snapshots/:snapshotId/restore",
  asyncHandler(snapshots.restore));
