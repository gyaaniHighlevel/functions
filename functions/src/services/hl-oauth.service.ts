import * as logger from "firebase-functions/logger";
import {FieldValue} from "firebase-admin/firestore";
import {z} from "zod";
import {db} from "../config/firebase";
import {hlConnectionRef} from "../models/hl-connection.model";
import {ExchangeCodeInput} from "../schemas/oauth.schema";
import {AppError} from "../utils/app-error";
import {DecryptError, decrypt, encrypt} from "../utils/crypto";

const HL_API_BASE = "https://services.leadconnectorhq.com";
const HL_TOKEN_URL = `${HL_API_BASE}/oauth/token`;
const LOCATIONS_API_VERSION = "2021-07-28";
const UPSTREAM_TIMEOUT_MS = 15_000;
const EXPIRY_SKEW_MS = 60_000;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
  locationId: z.string().optional(),
  companyId: z.string().optional(),
  userType: z.string().optional(),
});

type HlTokenResponse = z.infer<typeof tokenResponseSchema>;

/** Refresh grant rejected: the refresh token was consumed elsewhere or the
 * app was uninstalled — the connection is dead, not the upstream. */
class HlGrantError extends Error {
  constructor() {
    super("HighLevel rejected the refresh grant.");
    this.name = "HlGrantError";
  }
}

export interface ConnectionStatus {
  connected: boolean;
  locationId?: string;
  locationName?: string;
  companyId?: string;
  scopes?: string[];
  expiresAt?: number;
}

export interface FreshToken {
  accessToken: string;
  expiresAt: number;
  locationId: string;
}

function clientCredentials(): {clientId: string; clientSecret: string} {
  const clientId = process.env.HL_CLIENT_ID;
  const clientSecret = process.env.HL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("HL_CLIENT_ID / HL_CLIENT_SECRET secrets are not set.");
  }
  return {clientId, clientSecret};
}

async function requestToken(
  grant: Record<string, string>, uid: string): Promise<HlTokenResponse> {
  const {clientId, clientSecret} = clientCredentials();
  const res = await fetch(HL_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      ...grant,
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    logger.error("HL token endpoint rejected the request", {
      uid,
      grantType: grant.grant_type,
      status: res.status,
      detail: detail.slice(0, 500),
    });
    if (grant.grant_type === "refresh_token" &&
        [400, 401, 403].includes(res.status)) {
      throw new HlGrantError();
    }
    throw AppError.hlUpstream(
      "HighLevel rejected the token request. Try connecting again.");
  }

  const parsed = tokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error("HL token response had an unexpected shape", {
      uid, grantType: grant.grant_type,
    });
    throw AppError.hlUpstream(
      "HighLevel returned an unexpected token response.");
  }
  return parsed.data;
}

/** Cosmetic only — the raw id is an acceptable fallback. */
async function fetchLocationName(
  accessToken: string, locationId: string): Promise<string> {
  try {
    const res = await fetch(`${HL_API_BASE}/locations/${locationId}`, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Version": LOCATIONS_API_VERSION,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) {
      return locationId;
    }
    const body = await res.json() as {location?: {name?: string}};
    return body.location?.name || locationId;
  } catch {
    return locationId;
  }
}

export async function exchangeCode(
  uid: string, input: ExchangeCodeInput): Promise<ConnectionStatus> {
  const redirectUri = input.redirectUri ?? process.env.HL_REDIRECT_URI;
  if (!redirectUri) {
    throw AppError.validation(
      "No redirect URI available. Pass redirectUri in the request body " +
      "or configure HL_REDIRECT_URI on the backend.");
  }

  const token = await requestToken({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: redirectUri,
    user_type: input.userType,
  }, uid);

  if (!token.locationId) {
    throw AppError.validation(
      "This install is not tied to a location. Install the app on a " +
      "sub-account (location), not at the agency level.");
  }
  if (!token.refresh_token) {
    throw AppError.hlUpstream("HighLevel did not return a refresh token.");
  }

  const locationId = token.locationId;
  const expiresAt = Date.now() + token.expires_in * 1000;
  const locationName = await fetchLocationName(token.access_token, locationId);
  const userType = token.userType === "Company" ? "Company" : "Location";
  const scopes = token.scope?.split(" ").filter(Boolean) ?? [];

  // Full doc replace (re-connect is also the "switch location" path) plus
  // the display-only mirror, committed as one batch.
  const batch = db.batch();
  batch.set(hlConnectionRef(uid), {
    accessTokenEnc: encrypt(token.access_token, uid),
    refreshTokenEnc: encrypt(token.refresh_token, uid),
    locationId,
    companyId: token.companyId ?? "",
    userType,
    scopes,
    expiresAt,
    status: "connected",
    updatedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`users/${uid}`),
    {hl: {connected: true, locationId, locationName}}, {merge: true});
  await batch.commit();

  logger.info("HL connection established", {uid, locationId, scopes});
  return {
    connected: true,
    locationId,
    locationName,
    companyId: token.companyId ?? "",
    scopes,
    expiresAt,
  };
}

/** Lazy single-flight refresh (spec §5.3). The transaction re-read prevents
 * a refresh stampede — HighLevel rotates refresh tokens, so two parallel
 * refreshes with the same refresh token would kill the connection. */
export async function getFreshAccessToken(
  uid: string, force = false): Promise<FreshToken> {
  try {
    return await db.runTransaction(async (tx) => {
      const ref = hlConnectionRef(uid);
      const snap = await tx.get(ref);
      const conn = snap.data();
      if (!snap.exists || !conn || conn.status === "revoked") {
        throw AppError.hlNotConnected();
      }
      if (!force && conn.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
        return {
          accessToken: decrypt(conn.accessTokenEnc, uid),
          expiresAt: conn.expiresAt,
          locationId: conn.locationId,
        };
      }

      const refreshToken = decrypt(conn.refreshTokenEnc, uid);
      const t = await requestToken({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        user_type: conn.userType,
      }, uid);
      const expiresAt = Date.now() + t.expires_in * 1000;
      tx.update(ref, {
        accessTokenEnc: encrypt(t.access_token, uid),
        refreshTokenEnc: encrypt(t.refresh_token ?? refreshToken, uid),
        expiresAt,
        status: "connected",
        updatedAt: FieldValue.serverTimestamp(),
      });

      logger.info("HL access token refreshed", {uid, expiresAt});
      return {accessToken: t.access_token, expiresAt,
        locationId: conn.locationId};
    });
  } catch (err) {
    if (err instanceof HlGrantError || err instanceof DecryptError) {
      await markRevoked(uid);
      throw AppError.hlNotConnected(
        "The HighLevel connection is no longer valid. Connect again.");
    }
    throw err;
  }
}

export async function getConnectionStatus(
  uid: string): Promise<ConnectionStatus> {
  const snap = await hlConnectionRef(uid).get();
  const conn = snap.data();
  if (!snap.exists || !conn || conn.status === "revoked") {
    return {connected: false};
  }
  return {
    connected: true,
    locationId: conn.locationId,
    companyId: conn.companyId,
    scopes: conn.scopes,
    expiresAt: conn.expiresAt,
  };
}

async function markRevoked(uid: string): Promise<void> {
  try {
    const batch = db.batch();
    batch.set(hlConnectionRef(uid),
      {status: "revoked", updatedAt: FieldValue.serverTimestamp()},
      {merge: true});
    batch.set(db.doc(`users/${uid}`),
      {hl: {connected: false}}, {merge: true});
    await batch.commit();
    logger.info("HL connection marked revoked", {uid});
  } catch (err) {
    logger.error("Failed to mark HL connection revoked", {uid, err});
  }
}
