import {z} from "zod";
import {limitSchema} from "./common.schema";

/** HL entity ids are interpolated into upstream paths — this shape rules
 * out traversal and query smuggling via a crafted id. */
export const hlIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/,
  "Invalid HighLevel id.");

const shortText = (max: number) => z.string().trim().min(1).max(max);

// v3 dropped the plain contacts list endpoint; list is an unfiltered
// search, which pages by number instead of a startAfterId cursor.
export const listContactsQuerySchema = z.object({
  limit: limitSchema,
  page: z.coerce.number().int().min(1).max(1000).default(1),
}).strict();

export const searchContactsQuerySchema = z.object({
  query: shortText(200),
  limit: limitSchema,
}).strict();

// locationId is deliberately absent everywhere below: the proxy injects it
// from the caller's connection, so generated code can never target another
// location (INV-2).
const contactFields = {
  firstName: shortText(100).optional(),
  lastName: shortText(100).optional(),
  name: shortText(200).optional(),
  email: z.string().trim().email().max(320).optional(),
  phone: shortText(32).optional(),
  address1: shortText(200).optional(),
  city: shortText(100).optional(),
  state: shortText(100).optional(),
  postalCode: shortText(20).optional(),
  country: z.string().trim().length(2).optional(),
  website: shortText(2048).optional(),
  timezone: shortText(64).optional(),
  source: shortText(100).optional(),
  tags: z.array(shortText(80)).max(50).optional(),
  dnd: z.boolean().optional(),
};

export const createContactSchema = z.object({
  ...contactFields,
  companyName: shortText(200).optional(),
}).strict().refine(
  (d) => d.firstName || d.lastName || d.name || d.email || d.phone,
  {message: "Provide at least a name, an email, or a phone number."},
);

export const updateContactSchema = z.object(contactFields).strict().refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  {message: "Provide at least one field to update."},
);

export const listConversationsQuerySchema = z.object({
  limit: limitSchema,
}).strict();

export const listMessagesQuerySchema = z.object({
  limit: limitSchema,
  lastMessageId: hlIdSchema.optional(),
}).strict();

export const sendMessageSchema = z.object({
  type: z.enum(["SMS", "Email", "WhatsApp", "IG", "FB", "Live_Chat",
    "Custom"]),
  message: shortText(5000),
  subject: shortText(200).optional(),
}).strict();

export const listCalendarsQuerySchema = z.object({}).strict();

export const listAppointmentsQuerySchema = z.object({
  calendarId: hlIdSchema,
  startTime: shortText(64),
  endTime: shortText(64),
}).strict();

export const availabilityQuerySchema = z.object({
  startDate: z.coerce.number().int().positive(),
  endDate: z.coerce.number().int().positive(),
  timezone: shortText(64).optional(),
}).strict();

export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;
export type SearchContactsQuery = z.infer<typeof searchContactsQuerySchema>;
export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ListConversationsQuery =
  z.infer<typeof listConversationsQuerySchema>;
export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ListAppointmentsQuery =
  z.infer<typeof listAppointmentsQuerySchema>;
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
