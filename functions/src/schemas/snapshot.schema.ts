import {z} from "zod";
import {limitSchema, projectIdSchema, ulidSchema} from "./common.schema";

export const saveSnapshotBodySchema = z.object({
  label: z.string().trim().min(1).max(80).nullish(),
}).strict();

export const saveSnapshotSchema = saveSnapshotBodySchema.extend({
  projectId: projectIdSchema,
});

export const restoreSnapshotSchema = z.object({
  projectId: projectIdSchema,
  snapshotId: ulidSchema,
}).strict();

export const listSnapshotsQuerySchema = z.object({
  limit: limitSchema,
});
