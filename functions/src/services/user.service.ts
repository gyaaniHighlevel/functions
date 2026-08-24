import * as logger from "firebase-functions/logger";
import {FieldValue} from "firebase-admin/firestore";
import {db} from "../config/firebase";
import {UserDoc, userRef} from "../models/user.model";
import {AppError} from "../utils/app-error";
import {Identity} from "../utils/identity";

export async function ensureUserProfile(
  identity: Identity,
  displayName: string | null,
): Promise<{created: boolean}> {
  if (!identity.email) {
    throw AppError.validation(
      "Your account has no email address. Sign in with an email provider.");
  }
  const email = identity.email;
  const {uid} = identity;

  const created = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef(uid));
    if (snap.exists) {
      return false;
    }
    tx.set(userRef(uid), {
      email,
      displayName: displayName ?? identity.displayName,
      createdAt: FieldValue.serverTimestamp(),
      hl: {connected: false},
    });
    return true;
  });

  logger.info(created ? "User profile created" : "User profile already exists",
    {uid});
  return {created};
}

export async function getUserProfile(uid: string): Promise<UserDoc> {
  const snap = await userRef(uid).get();
  const profile = snap.data();
  if (!snap.exists || !profile) {
    throw AppError.notFound("Profile not found. Create it first.");
  }
  return profile;
}
