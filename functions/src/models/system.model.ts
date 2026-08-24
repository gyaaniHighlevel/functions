import {Timestamp} from "firebase-admin/firestore";
import {FilePath} from "./project.model";

// hlConnections/{uid} lives in hl-connection.model.ts (it has a typed ref).

/** oauthStates/{state} — server-only, single-use, TTL on expireAt. */
export interface OAuthStateDoc {
  uid: string;
  createdAt: Timestamp;
  expireAt: Timestamp;
}

/** cancellations/{generationId} — cancel intent flag. */
export interface CancellationDoc {
  uid: string;
  createdAt: Timestamp;
}

/** projects/{p}/messages/{messageId} — chat transcript; messageId = ULID. */
export interface MessageDoc {
  ownerUid: string;
  role: "user" | "assistant";
  content: string;
  filesChanged: FilePath[];
  generationId: string | null;
  createdAt: Timestamp;
}

/** projects/{p}/generations/{generationId} — status doc; reconnect truth. */
export interface GenerationDoc {
  ownerUid: string;
  status: "streaming" | "completed" | "failed" | "cancelled";
  prompt: string;
  model: string;
  startedAt: Timestamp;
  completedAt: Timestamp | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  } | null;
  snapshotId: string | null;
  filesChanged: FilePath[];
  error: {code: string; message: string} | null;
}
