import type {Request, Response} from "express";
import * as userService from "../services/user.service";

export async function createProfile(req: Request, res: Response) {
  const result = await userService.ensureUserProfile(
    res.locals.identity, req.body.displayName ?? null);
  res.status(result.created ? 201 : 200).json(result);
}

export async function me(_req: Request, res: Response) {
  res.json(await userService.getUserProfile(res.locals.identity.uid));
}
