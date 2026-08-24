import {DocumentReference, Timestamp} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {converter} from "./converter";

/** users/{uid} — client-readable profile; `hl` is a display-only mirror. */
export interface UserDoc {
  email: string;
  displayName: string | null;
  createdAt: Timestamp;
  hl: {connected: boolean; locationId?: string; locationName?: string};
}

export function userRef(uid: string): DocumentReference<UserDoc> {
  return db.doc(`users/${uid}`).withConverter(converter<UserDoc>());
}
