import * as logger from "firebase-functions/logger";
import {FieldValue} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {blobRef, fileRef, filesCol} from "../models/project.model";
import {
  Snapshot,
  SnapshotManifestEntry,
  snapshotRef,
  snapshotsCol,
} from "../models/snapshot.model";
import {AppError} from "../utils/app-error";
import {newId} from "../utils/ids";
import {loadOwnedProject} from "./project.service";

const ALREADY_EXISTS = 6;

async function writeBlobIfAbsent(
  projectId: string,
  uid: string,
  sha256: string,
  content: string,
  size: number,
): Promise<void> {
  try {
    await blobRef(projectId, sha256).create(
      {ownerUid: uid, content, size, createdAt: FieldValue.serverTimestamp()});
  } catch (err) {
    if ((err as {code?: number}).code === ALREADY_EXISTS) {
      return;
    }
    throw err;
  }
}

function manifestsEqual(
  a: SnapshotManifestEntry[],
  b: SnapshotManifestEntry[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const byPath = new Map(a.map((e) => [e.path, e.sha256]));
  return b.every((e) => byPath.get(e.path) === e.sha256);
}

export async function listSnapshots(
  uid: string,
  projectId: string,
  limit: number,
): Promise<Snapshot[]> {
  await loadOwnedProject(uid, projectId);
  const snap = await snapshotsCol(projectId)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({id: d.id, ...d.data()}));
}

export async function saveSnapshot(
  uid: string,
  input: {projectId: string; label: string | null},
): Promise<{snapshotId: string}> {
  const {ref: proj} = await loadOwnedProject(uid, input.projectId,
    {requireActive: true});

  const files = (await filesCol(input.projectId).get()).docs
    .map((d) => d.data());
  if (files.length === 0) {
    throw AppError.validation("This project has no files to snapshot.");
  }

  await Promise.all(files.map((f) =>
    writeBlobIfAbsent(input.projectId, uid, f.sha256, f.content, f.size)));

  const snapshotId = newId();
  const manifest: SnapshotManifestEntry[] = files.map(
    (f) => ({path: f.path, sha256: f.sha256, size: f.size}));

  const batch = db.batch();
  batch.set(snapshotRef(input.projectId, snapshotId), {
    ownerUid: uid, createdAt: FieldValue.serverTimestamp(),
    trigger: "manual", generationId: null, restoredFrom: null,
    label: input.label, files: manifest,
  });
  batch.update(proj, {
    headSnapshotId: snapshotId,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  logger.info("Snapshot saved", {uid, projectId: input.projectId, snapshotId});
  return {snapshotId};
}

export async function restoreSnapshot(
  uid: string,
  input: {projectId: string; snapshotId: string},
): Promise<{snapshotId: string; restored: boolean}> {
  const {ref: proj, project} = await loadOwnedProject(uid, input.projectId,
    {requireActive: true});
  if (project.activeGenerationId) {
    throw new AppError(409, "GENERATION_IN_FLIGHT",
      "A generation is running for this project. Wait for it to finish.");
  }

  const targetSnap = await snapshotRef(input.projectId, input.snapshotId).get();
  const target = targetSnap.data();
  if (!targetSnap.exists || !target) {
    throw AppError.notFound("Snapshot not found.");
  }

  const headSnap =
    await snapshotRef(input.projectId, project.headSnapshotId).get();
  const head = headSnap.data();
  if (head && manifestsEqual(head.files, target.files)) {
    logger.info("Restore skipped: already at target",
      {uid, projectId: input.projectId, snapshotId: input.snapshotId});
    return {snapshotId: project.headSnapshotId, restored: false};
  }

  const blobSnaps = await db.getAll(
    ...target.files.map((f) => blobRef(input.projectId, f.sha256)));
  const contentBySha = new Map(blobSnaps.map((s) => [s.id, s.data()]));

  const currentFiles = (await filesCol(input.projectId).get()).docs
    .map((d) => d.data());
  const targetPaths = new Set(target.files.map((f) => f.path));

  const newSnapshotId = newId();
  const batch = db.batch();

  for (const entry of target.files) {
    const blob = contentBySha.get(entry.sha256);
    if (!blob) {
      throw new AppError(502, "PERSISTENCE_FAILED",
        "Snapshot content is missing. Try another snapshot.");
    }
    batch.set(fileRef(input.projectId, entry.path), {
      ownerUid: uid, path: entry.path, content: blob.content as string,
      size: entry.size, sha256: entry.sha256,
      updatedAt: FieldValue.serverTimestamp(), updatedBy: "restore",
    });
  }
  for (const f of currentFiles) {
    if (!targetPaths.has(f.path)) {
      batch.delete(fileRef(input.projectId, f.path));
    }
  }

  batch.set(snapshotRef(input.projectId, newSnapshotId), {
    ownerUid: uid, createdAt: FieldValue.serverTimestamp(),
    trigger: "restore", generationId: null,
    restoredFrom: input.snapshotId, label: null, files: target.files,
  });
  batch.update(proj, {
    headSnapshotId: newSnapshotId,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  logger.info("Snapshot restored", {
    uid, projectId: input.projectId,
    restoredFrom: input.snapshotId, snapshotId: newSnapshotId,
  });
  return {snapshotId: newSnapshotId, restored: true};
}
