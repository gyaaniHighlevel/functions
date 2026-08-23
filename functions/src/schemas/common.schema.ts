import {z} from "zod";

export const projectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/,
  "Invalid project id.");

export const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/,
  "Invalid snapshot id.");

export const limitSchema = z.coerce.number().int().min(1).max(100).default(20);
