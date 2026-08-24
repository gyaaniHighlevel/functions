import {DecodedIdToken} from "firebase-admin/auth";

export interface Identity {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export function identityFromToken(token: DecodedIdToken): Identity {
  return {
    uid: token.uid,
    email: typeof token.email === "string" ? token.email : null,
    displayName: typeof token.name === "string" ? token.name : null,
  };
}
