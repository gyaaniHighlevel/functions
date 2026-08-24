import {
  CollectionReference,
  DocumentReference,
} from "firebase-admin/firestore";
import {converter} from "./converter";
import {projectRef} from "./project.model";
import {GenerationDoc, MessageDoc} from "./system.model";

export function generationsCol(
  projectId: string,
): CollectionReference<GenerationDoc> {
  return projectRef(projectId).collection("generations")
    .withConverter(converter<GenerationDoc>());
}

export function generationRef(
  projectId: string, generationId: string,
): DocumentReference<GenerationDoc> {
  return generationsCol(projectId).doc(generationId);
}

export function messagesCol(
  projectId: string,
): CollectionReference<MessageDoc> {
  return projectRef(projectId).collection("messages")
    .withConverter(converter<MessageDoc>());
}

export function messageRef(
  projectId: string, messageId: string,
): DocumentReference<MessageDoc> {
  return messagesCol(projectId).doc(messageId);
}
