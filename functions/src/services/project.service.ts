import * as logger from "firebase-functions/logger";
import {DocumentReference, FieldValue} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {
  FileDoc,
  FilePath,
  Project,
  ProjectDoc,
  blobRef,
  fileRef,
  filesCol,
  projectRef,
  projectsCol,
} from "../models/project.model";
import {SnapshotManifestEntry, snapshotRef} from "../models/snapshot.model";
import {userRef} from "../models/user.model";
import {CreateProjectInput, UpdateProjectInput} from "../schemas/project.schema";
import {STARTER_TEMPLATE} from "../templates/starter-template";
import {AppError} from "../utils/app-error";
import {byteSize, newId, sha256hex} from "../utils/ids";

export interface OwnedProject {
  ref: DocumentReference<ProjectDoc>;
  project: ProjectDoc;
}

export async function loadOwnedProject(
  uid: string,
  projectId: string,
  opts: {requireActive?: boolean} = {},
): Promise<OwnedProject> {
  const snap = await projectRef(projectId).get();
  const project = snap.data();
  if (!snap.exists || !project) {
    throw AppError.notFound("Project not found.");
  }
  if (project.ownerUid !== uid) {
    throw AppError.forbidden("You do not own this project.");
  }
  if (opts.requireActive && project.status !== "active") {
    throw AppError.notFound("Project has been deleted.");
  }
  return {ref: snap.ref, project};
}

export async function createProject(
  uid: string,
  input: CreateProjectInput,
): Promise<{projectId: string; snapshotId: string}> {
  const userSnap = await userRef(uid).get();
  const hlLocationId = userSnap.data()?.hl.locationId ?? null;

  const ref = projectsCol().doc();
  const snapshotId = newId();
  const manifest: SnapshotManifestEntry[] = [];
  const batch = db.batch();

  for (const [path, content] of
    Object.entries(STARTER_TEMPLATE) as [FilePath, string][]) {
    const sha256 = sha256hex(content);
    const size = byteSize(content);
    manifest.push({path, sha256, size});
    batch.set(blobRef(ref.id, sha256),
      {ownerUid: uid, content, size, createdAt: FieldValue.serverTimestamp()});
    batch.set(fileRef(ref.id, path), {
      ownerUid: uid, path, content, size, sha256,
      updatedAt: FieldValue.serverTimestamp(), updatedBy: "seed",
    });
  }

  batch.set(snapshotRef(ref.id, snapshotId), {
    ownerUid: uid, createdAt: FieldValue.serverTimestamp(),
    trigger: "seed", generationId: null, restoredFrom: null,
    label: "Starter template", files: manifest,
  });

  batch.set(ref, {
    ownerUid: uid,
    name: input.name,
    description: input.description,
    hlLocationId,
    status: "active",
    deletedAt: null,
    headSnapshotId: snapshotId,
    activeGenerationId: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  logger.info("Project created", {uid, projectId: ref.id, snapshotId});
  return {projectId: ref.id, snapshotId};
}

export async function listProjects(
  uid: string,
  opts: {status: ProjectDoc["status"]; limit: number},
): Promise<Project[]> {
  const snap = await projectsCol()
    .where("ownerUid", "==", uid)
    .where("status", "==", opts.status)
    .orderBy("updatedAt", "desc")
    .limit(opts.limit)
    .get();
  return snap.docs.map((d) => ({id: d.id, ...d.data()}));
}

export async function getProject(
  uid: string,
  projectId: string,
): Promise<Project> {
  const {ref, project} = await loadOwnedProject(uid, projectId);
  return {id: ref.id, ...project};
}

export async function listFiles(
  uid: string,
  projectId: string,
): Promise<FileDoc[]> {
  await loadOwnedProject(uid, projectId, {requireActive: true});
  const snap = await filesCol(projectId).get();
  return snap.docs.map((d) => d.data());
}

export async function updateProject(
  uid: string,
  projectId: string,
  input: UpdateProjectInput,
): Promise<{projectId: string}> {
  const {ref} = await loadOwnedProject(uid, projectId, {requireActive: true});

  await ref.update({
    ...(input.name !== undefined ? {name: input.name} : {}),
    ...(input.description !== undefined ?
      {description: input.description} : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info("Project updated", {uid, projectId});
  return {projectId};
}

export async function setProjectStatus(
  uid: string,
  projectId: string,
  status: ProjectDoc["status"],
): Promise<{projectId: string; status: ProjectDoc["status"]}> {
  const {ref} = await loadOwnedProject(uid, projectId);

  await ref.update({
    status,
    deletedAt: status === "deleted" ? FieldValue.serverTimestamp() : null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info("Project status changed", {uid, projectId, status});
  return {projectId, status};
}
