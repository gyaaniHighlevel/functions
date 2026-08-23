import "./config/firebase";
import {onRequest} from "firebase-functions/v2/https";
import {app} from "./app";

export const api = onRequest(app);

export {createUserProfile} from "./callables/user.callables";
export {
  createProject,
  renameProject,
  softDeleteProject,
  restoreProject,
} from "./callables/project.callables";
export {saveSnapshot, restoreSnapshot} from "./callables/snapshot.callables";

export {onProjectCreated} from "./triggers/project.triggers";
