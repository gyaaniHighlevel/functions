import {
  createProjectSchema,
  projectTargetSchema,
  renameProjectInputSchema,
} from "../schemas/project.schema";
import * as projectService from "../services/project.service";
import {callable} from "../utils/callable";

export const createProject = callable(
  "createProject",
  createProjectSchema,
  (identity, data) => projectService.createProject(identity.uid, data),
);

export const renameProject = callable(
  "renameProject",
  renameProjectInputSchema,
  (identity, data) =>
    projectService.updateProject(identity.uid, data.projectId, data),
);

export const softDeleteProject = callable(
  "softDeleteProject",
  projectTargetSchema,
  (identity, data) =>
    projectService.setProjectStatus(identity.uid, data.projectId, "deleted"),
);

export const restoreProject = callable(
  "restoreProject",
  projectTargetSchema,
  (identity, data) =>
    projectService.setProjectStatus(identity.uid, data.projectId, "active"),
);
