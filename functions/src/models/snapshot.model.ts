import {
  CollectionReference,
  DocumentReference,
  Timestamp,
} from "firebase-admin/firestore";
import {converter} from "./converter";
import {FilePath, projectRef} from "./project.model";

export interface SnapshotManifestEntry {
  path: FilePath;
  sha256: string;
  size: number;
}

/** projects/{p}/snapshots/{snapshotId} — manifest only; snapshotId = ULID. */
export interface SnapshotDoc {
  ownerUid: string;
  createdAt: Timestamp;
  trigger: "seed" | "generation" | "manual" | "restore";
  generationId: string | null;
  restoredFrom: string | null;
  label: string | null;
  files: SnapshotManifestEntry[];
}

export interface Snapshot extends SnapshotDoc {
  id: string;
}

export function snapshotsCol(projectId: string):
  CollectionReference<SnapshotDoc> {
  return projectRef(projectId).collection("snapshots")
    .withConverter(converter<SnapshotDoc>());
}

export function snapshotRef(projectId: string, snapshotId: string):
  DocumentReference<SnapshotDoc> {
  return snapshotsCol(projectId).doc(snapshotId);
}
