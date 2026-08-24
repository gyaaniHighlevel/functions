import {
  restoreSnapshotSchema,
  saveSnapshotSchema,
} from "../schemas/snapshot.schema";
import * as snapshotService from "../services/snapshot.service";
import {callable} from "../utils/callable";

export const saveSnapshot = callable(
  "saveSnapshot",
  saveSnapshotSchema,
  (identity, data) => snapshotService.saveSnapshot(identity.uid,
    {projectId: data.projectId, label: data.label ?? null}),
);

export const restoreSnapshot = callable(
  "restoreSnapshot",
  restoreSnapshotSchema,
  (identity, data) => snapshotService.restoreSnapshot(identity.uid, data),
);
