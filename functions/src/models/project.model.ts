import {
  CollectionReference,
  DocumentReference,
  Timestamp,
} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {fileId} from "../utils/ids";
import {converter} from "./converter";

export type FilePath = "index.html" | "app.js" | "styles.css";
export const ALLOWED_PATHS: ReadonlySet<string> =
  new Set(["index.html", "app.js", "styles.css"]);

/** projects/{projectId} */
export interface ProjectDoc {
  ownerUid: string;
  name: string;
  description: string;
  hlLocationId: string | null;
  status: "active" | "deleted";
  deletedAt: Timestamp | null;
  headSnapshotId: string;
  activeGenerationId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Shape the API returns: the document plus its id. */
export interface Project extends ProjectDoc {
  id: string;
}

/** projects/{p}/files/{fileId} — mutable working tree; fileId = base64url(path). */
export interface FileDoc {
  ownerUid: string;
  path: FilePath;
  content: string;
  size: number;
  sha256: string;
  updatedAt: Timestamp;
  updatedBy: "llm" | "user" | "restore" | "seed";
}

/** projects/{p}/blobs/{sha256} — immutable, content-addressed (INV-4). */
export interface BlobDoc {
  ownerUid: string;
  content: string;
  size: number;
  createdAt: Timestamp;
}

export function projectsCol(): CollectionReference<ProjectDoc> {
  return db.collection("projects").withConverter(converter<ProjectDoc>());
}

export function projectRef(projectId: string): DocumentReference<ProjectDoc> {
  return projectsCol().doc(projectId);
}

export function filesCol(projectId: string): CollectionReference<FileDoc> {
  return projectRef(projectId).collection("files")
    .withConverter(converter<FileDoc>());
}

export function fileRef(projectId: string, path: FilePath):
  DocumentReference<FileDoc> {
  return filesCol(projectId).doc(fileId(path));
}

export function blobRef(projectId: string, sha256: string):
  DocumentReference<BlobDoc> {
  return projectRef(projectId).collection("blobs").doc(sha256)
    .withConverter(converter<BlobDoc>());
}
