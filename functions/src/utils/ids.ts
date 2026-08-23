import {ulid} from "ulid";
import {createHash} from "node:crypto";

export const newId = ulid;

export const fileId = (path: string): string =>
  Buffer.from(path, "utf8").toString("base64url");

export const sha256hex = (content: string): string =>
  createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");

export const byteSize = (content: string): number =>
  Buffer.byteLength(content, "utf8");
