import "./config/firebase";
import {onRequest} from "firebase-functions/v2/https";
import {app} from "./app";
import {
  HL_CLIENT_ID,
  HL_CLIENT_SECRET,
  TOKEN_ENC_KEY,
  ANTHROPIC_API_KEY,
} from "./config/secrets";

export const api = onRequest(
  {
    secrets: [HL_CLIENT_ID, HL_CLIENT_SECRET, TOKEN_ENC_KEY, ANTHROPIC_API_KEY],
    timeoutSeconds: 540,
    memory: "1GiB",
  }, app);

export {createUserProfile} from "./callables/user.callables";
export {
  createProject,
  renameProject,
  softDeleteProject,
  restoreProject,
} from "./callables/project.callables";
export {saveSnapshot, restoreSnapshot} from "./callables/snapshot.callables";

export {onProjectCreated} from "./triggers/project.triggers";
