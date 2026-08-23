import type {Request, Response} from "express";
import * as hlOauthService from "../services/hl-oauth.service";
import {RefreshAccessTokenInput} from "../schemas/oauth.schema";
import {AppError} from "../utils/app-error";

export async function connect(req: Request, res: Response) {
  const result = await hlOauthService.exchangeCode(
    res.locals.identity.uid, req.body);
  res.status(201).json(result);
}

export async function token(req: Request, res: Response) {
  const uid: string = res.locals.identity.uid;
  const {userId, force} = req.body as RefreshAccessTokenInput;
  if (userId && userId !== uid) {
    throw AppError.forbidden(
      "You can only request an access token for your own account.");
  }
  res.json(await hlOauthService.getFreshAccessToken(uid, force));
}

export async function status(_req: Request, res: Response) {
  res.json(
    await hlOauthService.getConnectionStatus(res.locals.identity.uid));
}
