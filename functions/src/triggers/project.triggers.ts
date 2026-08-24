import {onDocumentCreated} from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";

export const onProjectCreated = onDocumentCreated(
  "projects/{projectId}",
  (event) => {
    const data = event.data?.data();
    logger.info("Project document created", {
      projectId: event.params.projectId,
      ownerUid: data?.ownerUid,
      name: data?.name,
    });
  },
);
