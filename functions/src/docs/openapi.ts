import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import {z} from "zod";
import {projectIdSchema, ulidSchema} from "../schemas/common.schema";
import {
  createProjectSchema,
  listProjectsQuerySchema,
  updateProjectSchema,
} from "../schemas/project.schema";
import {
  exchangeCodeSchema,
  refreshAccessTokenSchema,
} from "../schemas/oauth.schema";
import {
  availabilityQuerySchema,
  createContactSchema,
  hlIdSchema,
  listAppointmentsQuerySchema,
  listContactsQuerySchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  searchContactsQuerySchema,
  sendMessageSchema,
  updateContactSchema,
} from "../schemas/proxy.schema";
import {
  listSnapshotsQuerySchema,
  saveSnapshotBodySchema,
} from "../schemas/snapshot.schema";
import {createUserProfileSchema} from "../schemas/user.schema";

extendZodWithOpenApi(z);

// Response shapes below mirror models/*.ts (the runtime source of truth);
// Firestore Timestamps serialize over JSON as {_seconds, _nanoseconds}.
const timestampSchema = z.object({
  _seconds: z.number(),
  _nanoseconds: z.number(),
}).openapi({description: "Firestore Timestamp"});

const filePathSchema = z.enum(["index.html", "app.js", "styles.css"]);

const errorSchema = z.object({
  code: z.enum([
    "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "HL_NOT_CONNECTED",
    "GENERATION_IN_FLIGHT", "VALIDATION_FAILED", "RATE_LIMITED",
    "HL_RATE_LIMITED", "HL_UPSTREAM_ERROR", "LLM_OVERLOADED",
    "LLM_STREAM_ERROR", "MALFORMED_OUTPUT", "GENERATION_TIMEOUT",
    "PERSISTENCE_FAILED", "ORPHANED",
  ]),
  message: z.string(),
  retryAfter: z.number().optional(),
});

const projectSchema = z.object({
  id: z.string(),
  ownerUid: z.string(),
  name: z.string(),
  description: z.string(),
  hlLocationId: z.string().nullable(),
  status: z.enum(["active", "deleted"]),
  deletedAt: timestampSchema.nullable(),
  headSnapshotId: z.string(),
  activeGenerationId: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

const projectFileSchema = z.object({
  ownerUid: z.string(),
  path: filePathSchema,
  content: z.string(),
  size: z.number(),
  sha256: z.string(),
  updatedAt: timestampSchema,
  updatedBy: z.enum(["llm", "user", "restore", "seed"]),
});

const snapshotSchema = z.object({
  id: ulidSchema,
  ownerUid: z.string(),
  createdAt: timestampSchema,
  trigger: z.enum(["seed", "generation", "manual", "restore"]),
  generationId: z.string().nullable(),
  restoredFrom: z.string().nullable(),
  label: z.string().nullable(),
  files: z.array(z.object({
    path: filePathSchema,
    sha256: z.string(),
    size: z.number(),
  })),
});

const userProfileSchema = z.object({
  email: z.string(),
  displayName: z.string().nullable(),
  createdAt: timestampSchema,
  hl: z.object({
    connected: z.boolean(),
    locationId: z.string().optional(),
    locationName: z.string().optional(),
  }),
});

const hlConnectionStatusSchema = z.object({
  connected: z.boolean(),
  locationId: z.string().optional(),
  locationName: z.string().optional(),
  companyId: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.number().optional()
    .openapi({description: "Access token expiry, epoch ms."}),
});

const hlFreshTokenSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.number().openapi({description: "Epoch ms."}),
  locationId: z.string(),
});

// Proxy response shapes: HL envelopes normalized to the SDK contract,
// unpromised upstream fields stripped (hl-proxy.service.ts).
const hlContactSchema = z.object({
  id: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  companyName: z.string().optional(),
  address1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  website: z.string().optional(),
  timezone: z.string().optional(),
  dnd: z.boolean().optional(),
  assignedTo: z.string().optional(),
  dateAdded: z.string().optional(),
  dateUpdated: z.string().optional(),
});

const hlConversationSchema = z.object({
  id: z.string(),
  contactId: z.string().optional(),
  fullName: z.string().optional(),
  contactName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  lastMessageBody: z.string().optional(),
  lastMessageType: z.string().optional(),
  type: z.string().optional(),
  unreadCount: z.number().optional(),
});

const hlMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string().optional(),
  contactId: z.string().optional(),
  type: z.number().optional(),
  messageType: z.string().optional(),
  direction: z.string().optional(),
  status: z.string().optional(),
  body: z.string().optional(),
  contentType: z.string().optional(),
  attachments: z.array(z.string()).optional(),
  dateAdded: z.string().optional(),
});

const hlCalendarSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  calendarType: z.string().optional(),
  groupId: z.string().optional(),
});

const hlEventSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  calendarId: z.string().optional(),
  contactId: z.string().optional(),
  appointmentStatus: z.string().optional(),
  assignedUserId: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

const hlAvailabilitySchema = z.object({
  availability: z.record(
    z.string().openapi({description: "Date key, YYYY-MM-DD."}),
    z.object({slots: z.array(z.string())})),
});

const hlSendResultSchema = z.object({
  conversationId: z.string().optional(),
  messageId: z.string().optional(),
  status: z.string().optional(),
});

const projectParams = z.object({projectId: projectIdSchema});
const snapshotParams = z.object({
  projectId: projectIdSchema,
  snapshotId: ulidSchema,
});

type ZodSchema = z.ZodTypeAny;

const json = (schema: ZodSchema) =>
  ({content: {"application/json": {schema}}});

const ok = (description: string, schema: ZodSchema) =>
  ({description, ...json(schema)});

const err = (description: string) => ({description, ...json(errorSchema)});

const body = (schema: ZodSchema) => ({required: true, ...json(schema)});

const authErrors = {401: err("Missing or invalid Firebase ID token.")};
const ownedErrors = {
  ...authErrors,
  403: err("You do not own this project."),
  404: err("Project not found (or deleted)."),
};

export function buildOpenApiDocument():
  ReturnType<OpenApiGeneratorV3["generateDocument"]> {
  const registry = new OpenAPIRegistry();

  registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "Firebase Auth ID token (emulator: sign up at " +
      "http://127.0.0.1:9099 and use the returned idToken).",
  });

  registry.register("Error", errorSchema);
  const project = registry.register("Project", projectSchema);
  const projectFile = registry.register("ProjectFile", projectFileSchema);
  const snapshot = registry.register("Snapshot", snapshotSchema);
  const userProfile = registry.register("UserProfile", userProfileSchema);

  registry.registerPath({
    method: "get",
    path: "/healthz",
    tags: ["System"],
    summary: "Liveness check",
    security: [],
    responses: {200: ok("Service is up.", z.object({ok: z.boolean()}))},
  });

  registry.registerPath({
    method: "post",
    path: "/users/profile",
    tags: ["Users"],
    summary: "Create the caller's profile (idempotent)",
    request: {body: body(createUserProfileSchema)},
    responses: {
      201: ok("Profile created.", z.object({created: z.literal(true)})),
      200: ok("Profile already existed.",
        z.object({created: z.literal(false)})),
      ...authErrors,
      422: err("Account has no email address, or invalid input."),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/users/me",
    tags: ["Users"],
    summary: "Get the caller's profile",
    responses: {
      200: ok("The caller's profile.", userProfile),
      ...authErrors,
      404: err("Profile not found. Create it first."),
    },
  });

  const hlStatus = registry.register(
    "HlConnectionStatus", hlConnectionStatusSchema);

  registry.registerPath({
    method: "post",
    path: "/oauth/hl/connect",
    tags: ["HighLevel OAuth"],
    summary: "Exchange a HighLevel authorization code for a connection",
    description: "The frontend completes the marketplace OAuth redirect, " +
      "grabs ?code=... and posts it here. The backend exchanges it with " +
      "client_id/client_secret, encrypts both tokens (AES-256-GCM, AAD = " +
      "uid), full-replaces hlConnections/{uid}, and mirrors users/{uid}.hl.",
    request: {body: body(exchangeCodeSchema)},
    responses: {
      201: ok("Connected. Tokens are stored server-side, never returned.",
        hlStatus),
      ...authErrors,
      422: err("Invalid input, missing redirect URI, or agency-level " +
        "install (a location install is required)."),
      502: err("HighLevel rejected the code exchange."),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/oauth/hl/token",
    tags: ["HighLevel OAuth"],
    summary: "Get a fresh HighLevel access token for the caller",
    description: "Lazy single-flight refresh: returns the stored token " +
      "while it is still valid, otherwise refreshes it (HighLevel rotates " +
      "refresh tokens; the transaction prevents a refresh stampede). " +
      "userId, when passed, must match the caller. force=true always " +
      "refreshes.",
    request: {body: body(refreshAccessTokenSchema)},
    responses: {
      200: ok("A valid access token.", hlFreshTokenSchema),
      ...authErrors,
      403: err("userId does not match the caller."),
      409: err("HighLevel is not connected (or the connection was " +
        "revoked). Connect again."),
      502: err("HighLevel token endpoint failed."),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/oauth/hl/status",
    tags: ["HighLevel OAuth"],
    summary: "Get the caller's HighLevel connection status",
    responses: {
      200: ok("connected=false when never connected or revoked.", hlStatus),
      ...authErrors,
    },
  });

  const proxyErrors = {
    ...authErrors,
    409: err("HighLevel is not connected (or the connection was revoked)."),
    422: err("Invalid parameters, or HighLevel rejected the request."),
    429: err("HighLevel rate limit (HL_RATE_LIMITED), forwarded with " +
      "Retry-After when HighLevel provides it."),
    502: err("HighLevel upstream error or timeout."),
  };

  registry.registerPath({
    method: "get",
    path: "/hl/contacts",
    tags: ["HighLevel Proxy"],
    summary: "List contacts (SDK: hl.contacts.list)",
    description: "locationId is injected server-side from the caller's " +
      "connection on every proxy route — generated code can never target " +
      "another location. Pages by number (HL API v3 has no list " +
      "endpoint; this is an unfiltered search).",
    request: {query: listContactsQuerySchema},
    responses: {
      200: ok("Contacts in the connected location.", z.object({
        contacts: z.array(hlContactSchema),
        total: z.number(),
      })),
      ...proxyErrors,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/hl/contacts/search",
    tags: ["HighLevel Proxy"],
    summary: "Search contacts (SDK: hl.contacts.search)",
    request: {query: searchContactsQuerySchema},
    responses: {
      200: ok("Matching contacts.", z.object({
        contacts: z.array(hlContactSchema),
        total: z.number(),
      })),
      ...proxyErrors,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/hl/contacts",
    tags: ["HighLevel Proxy"],
    summary: "Create a contact (SDK: hl.contacts.create)",
    request: {body: body(createContactSchema)},
    responses: {
      201: ok("The created contact.",
        z.object({contact: hlContactSchema})),
      ...proxyErrors,
    },
  });

  registry.registerPath({
    method: "put",
    path: "/hl/contacts/{contactId}",
    tags: ["HighLevel Proxy"],
    summary: "Update a contact (SDK: hl.contacts.update)",
    request: {
      params: z.object({contactId: hlIdSchema}),
      body: body(updateContactSchema),
    },
    responses: {
      200: ok("The updated contact.",
        z.object({contact: hlContactSchema})),
      404: err("Contact not found."),
      ...proxyErrors,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/hl/conversations",
    tags: ["HighLevel Proxy"],
    summary: "List conversations (SDK: hl.conversations.list)",
    request: {query: listConversationsQuerySchema},
    responses: {
      200: ok("Recent conversations.", z.object({
        conversations: z.array(hlConversationSchema),
        total: z.number(),
      })),
      ...proxyErrors,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/hl/conversations/{conversationId}/messages",
    tags: ["HighLevel Proxy"],
    summary: "Get messages (SDK: hl.conversations.messages)",
    request: {
      params: z.object({conversationId: hlIdSchema}),
      query: listMessagesQuerySchema,
    },
    responses: {
      200: ok("Messages, newest first. Pass lastMessageId to page.",
        z.object({
          messages: z.array(hlMessageSchema),
          lastMessageId: z.string().nullable(),
          nextPage: z.boolean(),
        })),
      404: err("Conversation not found."),
      ...proxyErrors,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/hl/conversations/{conversationId}/messages",
    tags: ["HighLevel Proxy"],
    summary: "Send a message (SDK: hl.conversations.send)",
    description: "The proxy resolves the conversation's contactId " +
      "upstream, so the SDK contract stays conversation-scoped.",
    request: {
      params: z.object({conversationId: hlIdSchema}),
      body: body(sendMessageSchema),
    },
    responses: {
      201: ok("Message queued/sent.", hlSendResultSchema),
      404: err("Conversation not found."),
      ...proxyErrors,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/hl/calendars",
    tags: ["HighLevel Proxy"],
    summary: "List calendars (SDK: hl.calendars.list)",
    responses: {
      200: ok("Calendars in the connected location.",
        z.object({calendars: z.array(hlCalendarSchema)})),
      ...proxyErrors,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/hl/calendars/appointments",
    tags: ["HighLevel Proxy"],
    summary: "Get appointments (SDK: hl.calendars.appointments)",
    request: {query: listAppointmentsQuerySchema},
    responses: {
      200: ok("Calendar events in the window.",
        z.object({events: z.array(hlEventSchema)})),
      ...proxyErrors,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/hl/calendars/{calendarId}/availability",
    tags: ["HighLevel Proxy"],
    summary: "Get free slots (SDK: hl.calendars.availability)",
    request: {
      params: z.object({calendarId: hlIdSchema}),
      query: availabilityQuerySchema,
    },
    responses: {
      200: ok("Free slots keyed by date.", hlAvailabilitySchema),
      404: err("Calendar not found."),
      ...proxyErrors,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/projects",
    tags: ["Projects"],
    summary: "Create a project seeded with the starter template",
    request: {body: body(createProjectSchema)},
    responses: {
      201: ok("Project created with its seed snapshot.",
        z.object({projectId: z.string(), snapshotId: ulidSchema})),
      ...authErrors,
      422: err("Invalid input."),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/projects",
    tags: ["Projects"],
    summary: "List the caller's projects",
    request: {query: listProjectsQuerySchema},
    responses: {
      200: ok("Projects ordered by updatedAt desc.",
        z.object({items: z.array(project)})),
      ...authErrors,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/projects/{projectId}",
    tags: ["Projects"],
    summary: "Get one project",
    request: {params: projectParams},
    responses: {
      200: ok("The project.", project),
      ...ownedErrors,
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/projects/{projectId}",
    tags: ["Projects"],
    summary: "Rename a project or update its description",
    request: {params: projectParams, body: body(updateProjectSchema)},
    responses: {
      200: ok("Updated.", z.object({projectId: z.string()})),
      ...ownedErrors,
      422: err("Provide a name or a description to update."),
    },
  });

  const statusResult = z.object({
    projectId: z.string(),
    status: z.enum(["active", "deleted"]),
  });

  registry.registerPath({
    method: "delete",
    path: "/projects/{projectId}",
    tags: ["Projects"],
    summary: "Soft-delete a project",
    request: {params: projectParams},
    responses: {
      200: ok("Project marked deleted.", statusResult),
      ...ownedErrors,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/projects/{projectId}/restore",
    tags: ["Projects"],
    summary: "Restore a soft-deleted project",
    request: {params: projectParams},
    responses: {
      200: ok("Project restored to active.", statusResult),
      ...ownedErrors,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/projects/{projectId}/files",
    tags: ["Files"],
    summary: "List the project's working-tree files",
    request: {params: projectParams},
    responses: {
      200: ok("The fixed three-file working tree.",
        z.object({items: z.array(projectFile)})),
      ...ownedErrors,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/projects/{projectId}/snapshots",
    tags: ["Snapshots"],
    summary: "List snapshots (manifests only)",
    request: {params: projectParams, query: listSnapshotsQuerySchema},
    responses: {
      200: ok("Snapshots ordered by createdAt desc.",
        z.object({items: z.array(snapshot)})),
      ...ownedErrors,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/projects/{projectId}/snapshots",
    tags: ["Snapshots"],
    summary: "Save a manual snapshot of the working tree",
    request: {params: projectParams, body: body(saveSnapshotBodySchema)},
    responses: {
      201: ok("Snapshot saved and set as head.",
        z.object({snapshotId: ulidSchema})),
      ...ownedErrors,
      422: err("This project has no files to snapshot."),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/projects/{projectId}/snapshots/{snapshotId}/restore",
    tags: ["Snapshots"],
    summary: "Restore the working tree from a snapshot",
    request: {params: snapshotParams},
    responses: {
      200: ok("restored=false means the head already matched the target.",
        z.object({snapshotId: ulidSchema, restored: z.boolean()})),
      ...ownedErrors,
      409: err("A generation is running for this project."),
      502: err("Snapshot content is missing."),
    },
  });

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Genesis API",
      version: "1.0.0",
      description: "REST surface of the Genesis backend (Firebase Cloud " +
        "Functions). All routes except /healthz require a Firebase ID " +
        "token. Errors follow the {code, message, retryAfter?} contract.",
    },
    security: [{bearerAuth: []}],
    servers: [{url: "/"}],
  });
}
