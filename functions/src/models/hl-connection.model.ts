import {DocumentReference, Timestamp} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {converter} from "./converter";

/** hlConnections/{uid} — SERVER-ONLY (INV-2). Rules deny all client access.
 * Tokens are AES-256-GCM envelopes with AAD = uid. */
export interface HlConnectionDoc {
  accessTokenEnc: string;
  refreshTokenEnc: string;
  locationId: string;
  companyId: string;
  userType: "Location" | "Company";
  scopes: string[];
  expiresAt: number;
  status: "connected" | "revoked";
  updatedAt: Timestamp;
}

export function hlConnectionRef(
  uid: string): DocumentReference<HlConnectionDoc> {
  return db.doc(`hlConnections/${uid}`)
    .withConverter(converter<HlConnectionDoc>());
}
