import {z} from "zod";

export const createUserProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
}).strict();

export type CreateUserProfileInput = z.infer<typeof createUserProfileSchema>;
