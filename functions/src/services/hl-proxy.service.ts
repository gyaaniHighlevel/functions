import * as logger from "firebase-functions/logger";
import {
  AvailabilityQuery,
  CreateContactInput,
  ListAppointmentsQuery,
  ListContactsQuery,
  ListConversationsQuery,
  ListMessagesQuery,
  SearchContactsQuery,
  SendMessageInput,
  UpdateContactInput,
} from "../schemas/proxy.schema";
import {AppError} from "../utils/app-error";
import {getFreshAccessToken, markRevoked} from "./hl-oauth.service";

// API v3 per the marketplace OpenAPI specs
// (github.com/GoHighLevel/api-v2-docs, apps/v3): same host and paths as v2,
// addressed by the `Version: v3` header. If the sandbox instead wants the
// `/v3` path prefix the specs' prose mentions, change only HL_API_BASE.
const HL_API_BASE = "https://services.leadconnectorhq.com";
const HL_API_VERSION = "v3";
const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

type Json = Record<string, unknown>;

interface UpstreamRequest {
  method: "GET" | "POST" | "PUT";
  path: string;
  version: string;
  query?: Record<string, string | number | undefined>;
  body?: Json;
}

/** Proxy pipeline steps 5–8 (spec §5.4): fresh token, locationId injected
 * server-side, one refresh-and-retry on an upstream 401, envelope checks.
 * All error messages are user-facing — generated apps render them verbatim. */
async function callHl(
  uid: string,
  build: (locationId: string) => UpstreamRequest): Promise<Json> {
  let fresh = await getFreshAccessToken(uid);
  let res = await send(uid, build(fresh.locationId), fresh.accessToken);
  if (res.status === 401) {
    fresh = await getFreshAccessToken(uid, true);
    res = await send(uid, build(fresh.locationId), fresh.accessToken);
    if (res.status === 401) {
      await markRevoked(uid);
      throw AppError.hlNotConnected(
        "The HighLevel connection is no longer valid. Connect again.");
    }
  }
  return parseUpstream(uid, res);
}

async function send(
  uid: string, req: UpstreamRequest, accessToken: string): Promise<Response> {
  const url = new URL(HL_API_BASE + req.path);
  for (const [key, value] of Object.entries(req.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  try {
    return await fetch(url, {
      method: req.method,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Version": req.version,
        "Accept": "application/json",
        ...(req.body ? {"Content-Type": "application/json"} : {}),
      },
      body: req.body ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    logger.error("HL upstream unreachable",
      {uid, path: req.path, error: String(err)});
    throw AppError.hlUpstream("HighLevel didn't respond. Try again.");
  }
}

async function parseUpstream(uid: string, res: Response): Promise<Json> {
  const text = await res.text();
  let json: Json = {};
  try {
    json = text ? JSON.parse(text) as Json : {};
  } catch {
    json = {};
  }

  if (res.ok) {
    if (text.length > MAX_RESPONSE_BYTES) {
      logger.error("HL response over size cap", {uid, size: text.length});
      throw AppError.hlUpstream(
        "HighLevel returned too much data. Narrow the request.");
    }
    return json;
  }

  const detail = upstreamMessage(json);
  logger.error("HL upstream rejected the request",
    {uid, status: res.status, detail});
  if (res.status === 404) {
    throw AppError.notFound(detail ?? "Not found in HighLevel.");
  }
  if (res.status === 429) {
    const retryAfter =
      Number(res.headers.get("retry-after")) || undefined;
    throw AppError.hlRateLimited(
      "HighLevel is receiving too many requests. Try again in a moment.",
      retryAfter);
  }
  if (res.status === 400 || res.status === 422) {
    throw AppError.validation(detail ?? "HighLevel rejected the request.");
  }
  if (res.status === 403) {
    throw AppError.forbidden(
      "Your HighLevel connection does not allow this action.");
  }
  throw AppError.hlUpstream("HighLevel didn't respond. Try again.");
}

function upstreamMessage(json: Json): string | undefined {
  const m = json.message;
  if (typeof m === "string" && m.trim()) {
    return m.slice(0, 300);
  }
  if (Array.isArray(m) && m.length) {
    return m.map(String).join("; ").slice(0, 300);
  }
  return undefined;
}

// Normalizers keep generated code on the documented SDK surface only —
// unpromised upstream fields are stripped so they can shift under HL
// without breaking anyone (spec §5.4 step 8).

const asArray = (v: unknown): Json[] => (Array.isArray(v) ? v as Json[] : []);

function pick(obj: unknown, keys: readonly string[]): Json {
  const src = (obj ?? {}) as Json;
  const out: Json = {};
  for (const key of keys) {
    if (src[key] !== undefined) {
      out[key] = src[key];
    }
  }
  return out;
}

const CONTACT_FIELDS = [
  "id", "firstName", "lastName", "name", "email", "phone", "tags", "source",
  "companyName", "address1", "city", "state", "country", "postalCode",
  "website", "timezone", "dnd", "assignedTo", "dateAdded", "dateUpdated",
] as const;

const CONVERSATION_FIELDS = [
  "id", "contactId", "fullName", "contactName", "email", "phone",
  "lastMessageBody", "lastMessageType", "type", "unreadCount",
] as const;

const MESSAGE_FIELDS = [
  "id", "conversationId", "contactId", "type", "messageType", "direction",
  "status", "body", "contentType", "attachments", "dateAdded",
] as const;

const CALENDAR_FIELDS = [
  "id", "name", "description", "isActive", "calendarType", "groupId",
] as const;

const EVENT_FIELDS = [
  "id", "title", "calendarId", "contactId", "appointmentStatus",
  "assignedUserId", "address", "notes", "startTime", "endTime",
] as const;

export async function listContacts(
  uid: string, q: ListContactsQuery): Promise<Json> {
  // v3 has no plain list endpoint — an unfiltered search is the list.
  const json = await callHl(uid, (locationId) => ({
    method: "POST",
    path: "/contacts/search",
    version: HL_API_VERSION,
    body: {locationId, page: q.page, pageLimit: q.limit},
  }));
  const contacts = asArray(json.contacts);
  return {
    contacts: contacts.map((c) => pick(c, CONTACT_FIELDS)),
    total: typeof json.total === "number" ? json.total : contacts.length,
  };
}

export async function searchContacts(
  uid: string, q: SearchContactsQuery): Promise<Json> {
  const json = await callHl(uid, (locationId) => ({
    method: "POST",
    path: "/contacts/search",
    version: HL_API_VERSION,
    body: {locationId, query: q.query, pageLimit: q.limit},
  }));
  const contacts = asArray(json.contacts);
  return {
    contacts: contacts.map((c) => pick(c, CONTACT_FIELDS)),
    total: typeof json.total === "number" ? json.total : contacts.length,
  };
}

export async function createContact(
  uid: string, input: CreateContactInput): Promise<Json> {
  const json = await callHl(uid, (locationId) => ({
    method: "POST",
    path: "/contacts/",
    version: HL_API_VERSION,
    body: {...input, locationId},
  }));
  return {contact: pick(json.contact, CONTACT_FIELDS)};
}

export async function updateContact(
  uid: string, contactId: string, input: UpdateContactInput): Promise<Json> {
  const json = await callHl(uid, () => ({
    method: "PUT",
    path: `/contacts/${contactId}`,
    version: HL_API_VERSION,
    body: {...input},
  }));
  return {contact: pick(json.contact, CONTACT_FIELDS)};
}

export async function listConversations(
  uid: string, q: ListConversationsQuery): Promise<Json> {
  const json = await callHl(uid, (locationId) => ({
    method: "GET",
    path: "/conversations/search",
    version: HL_API_VERSION,
    query: {locationId, limit: q.limit},
  }));
  const conversations = asArray(json.conversations);
  return {
    conversations: conversations.map((c) => pick(c, CONVERSATION_FIELDS)),
    total: typeof json.total === "number" ?
      json.total : conversations.length,
  };
}

export async function listMessages(
  uid: string, conversationId: string, q: ListMessagesQuery): Promise<Json> {
  const json = await callHl(uid, () => ({
    method: "GET",
    path: `/conversations/${conversationId}/messages`,
    version: HL_API_VERSION,
    query: {limit: q.limit, lastMessageId: q.lastMessageId},
  }));
  // Live API nests the payload under "messages"; the docs show it flat.
  const envelope = (json.messages && !Array.isArray(json.messages)) ?
    json.messages as Json : json;
  return {
    messages: asArray(envelope.messages).map((m) => pick(m, MESSAGE_FIELDS)),
    lastMessageId: typeof envelope.lastMessageId === "string" ?
      envelope.lastMessageId : null,
    nextPage: envelope.nextPage === true,
  };
}

export async function sendMessage(
  uid: string, conversationId: string,
  input: SendMessageInput): Promise<Json> {
  // HL's send endpoint takes a contactId, not a conversationId — resolve
  // it upstream so the SDK contract can stay conversation-scoped.
  const conversation = await callHl(uid, () => ({
    method: "GET",
    path: `/conversations/${conversationId}`,
    version: HL_API_VERSION,
  }));
  const contactId = conversation.contactId;
  if (typeof contactId !== "string" || !contactId) {
    throw AppError.notFound("Conversation not found.");
  }

  const json = await callHl(uid, () => ({
    method: "POST",
    path: "/conversations/messages",
    version: HL_API_VERSION,
    body: {
      type: input.type,
      contactId,
      message: input.message,
      ...(input.subject ? {subject: input.subject} : {}),
    },
  }));
  return pick(json, ["conversationId", "messageId", "status"]);
}

export async function listCalendars(uid: string): Promise<Json> {
  const json = await callHl(uid, (locationId) => ({
    method: "GET",
    path: "/calendars/",
    version: HL_API_VERSION,
    query: {locationId},
  }));
  return {
    calendars: asArray(json.calendars).map((c) => pick(c, CALENDAR_FIELDS)),
  };
}

export async function listAppointments(
  uid: string, q: ListAppointmentsQuery): Promise<Json> {
  const json = await callHl(uid, (locationId) => ({
    method: "GET",
    path: "/calendars/events",
    version: HL_API_VERSION,
    query: {
      locationId,
      calendarId: q.calendarId,
      startTime: q.startTime,
      endTime: q.endTime,
    },
  }));
  return {events: asArray(json.events).map((e) => pick(e, EVENT_FIELDS))};
}

export async function getAvailability(
  uid: string, calendarId: string, q: AvailabilityQuery): Promise<Json> {
  const json = await callHl(uid, () => ({
    method: "GET",
    path: `/calendars/${calendarId}/free-slots`,
    version: HL_API_VERSION,
    query: {
      startDate: q.startDate,
      endDate: q.endDate,
      timezone: q.timezone,
    },
  }));
  // Upstream is a map keyed by date (plus noise like traceId) — keep only
  // the date buckets and their slots.
  const availability: Json = {};
  for (const [key, value] of Object.entries(json)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      continue;
    }
    const slots = (value as Json | null)?.slots;
    availability[key] =
      {slots: Array.isArray(slots) ? slots.map(String) : []};
  }
  return {availability};
}
