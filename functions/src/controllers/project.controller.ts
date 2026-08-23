import type {Request, Response} from "express";
import {projectIdSchema} from "../schemas/common.schema";
import {listProjectsQuerySchema} from "../schemas/project.schema";
import * as projectService from "../services/project.service";

const uid = (res: Response): string => res.locals.identity.uid;
const projectId = (req: Request): string =>
  projectIdSchema.parse(req.params.projectId);

export async function create(req: Request, res: Response) {
  res.status(201).json(
    await projectService.createProject(uid(res), req.body));
}

export async function list(req: Request, res: Response) {
  const query = listProjectsQuerySchema.parse(req.query);
  res.json({items: await projectService.listProjects(uid(res), query)});
}

export async function get(req: Request, res: Response) {
  res.json(await projectService.getProject(uid(res), projectId(req)));
}

export async function listFiles(req: Request, res: Response) {
  res.json({items: await projectService.listFiles(uid(res), projectId(req))});
}

export async function update(req: Request, res: Response) {
  res.json(await projectService.updateProject(
    uid(res), projectId(req), req.body));
}

export async function softDelete(req: Request, res: Response) {
  res.json(await projectService.setProjectStatus(
    uid(res), projectId(req), "deleted"));
}

export async function restore(req: Request, res: Response) {
  res.json(await projectService.setProjectStatus(
    uid(res), projectId(req), "active"));
}
