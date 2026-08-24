import {z} from "zod";

export const exchangeCodeSchema = z.object({
  code: z.string().trim().min(1).max(512),
  redirectUri: z.string().url().max(2048).optional(),
  userType: z.enum(["Location", "Company"]).default("Location"),
}).strict();

export type ExchangeCodeInput = z.infer<typeof exchangeCodeSchema>;

export const refreshAccessTokenSchema = z.object({
  userId: z.string().trim().min(1).max(128).optional(),
  force: z.boolean().default(false),
}).strict();

export type RefreshAccessTokenInput = z.infer<typeof refreshAccessTokenSchema>;
