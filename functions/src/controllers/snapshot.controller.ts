import type {Request, Response} from "express";
import {projectIdSchema, ulidSchema} from "../schemas/common.schema";
import {listSnapshotsQuerySchema} from "../schemas/snapshot.schema";
import * as snapshotService from "../services/snapshot.service";

const uid = (res: Response): string => res.locals.identity.uid;
const projectId = (req: Request): string =>
  projectIdSchema.parse(req.params.projectId);

export async function list(req: Request, res: Response) {
  const {limit} = listSnapshotsQuerySchema.parse(req.query);
  res.json({items:
    await snapshotService.listSnapshots(uid(res), projectId(req), limit)});
}

export async function save(req: Request, res: Response) {
  res.status(201).json(await snapshotService.saveSnapshot(uid(res), {
    projectId: projectId(req),
    label: req.body.label ?? null,
  }));
}

export async function restore(req: Request, res: Response) {
  res.json(await snapshotService.restoreSnapshot(uid(res), {
    projectId: projectId(req),
    snapshotId: ulidSchema.parse(req.params.snapshotId),
  }));
}
