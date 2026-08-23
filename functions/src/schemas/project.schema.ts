import {z} from "zod";
import {limitSchema, projectIdSchema} from "./common.schema";

const nameSchema = z.string().trim().min(1).max(80);
const descriptionSchema = z.string().trim().max(500);

export const createProjectSchema = z.object({
  name: nameSchema,
  description: descriptionSchema.default(""),
}).strict();

export const updateProjectSchema = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
}).strict().refine(
  (d) => d.name !== undefined || d.description !== undefined,
  {message: "Provide a name or a description to update."},
);

export const projectTargetSchema = z.object({
  projectId: projectIdSchema,
}).strict();

/** Callable twin of PATCH /projects/:id — one flat strict object, because an
 * intersection of two .strict() schemas rejects each other's keys. */
export const renameProjectInputSchema = z.object({
  projectId: projectIdSchema,
  name: nameSchema.optional(),
  description: descriptionSchema.optional(),
}).strict().refine(
  (d) => d.name !== undefined || d.description !== undefined,
  {message: "Provide a name or a description to update."},
);

export const listProjectsQuerySchema = z.object({
  status: z.enum(["active", "deleted"]).default("active"),
  limit: limitSchema,
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
