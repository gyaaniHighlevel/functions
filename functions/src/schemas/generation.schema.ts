import {z} from "zod";

export const generateRequestSchema = z.object({
  projectId: z.string().min(1).max(64),
  prompt: z.string().min(1).max(4000),
}).strict();

export type GenerateRequest = z.infer<typeof generateRequestSchema>;
