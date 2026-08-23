import {defineSecret} from "firebase-functions/params";

export const HL_CLIENT_ID = defineSecret("HL_CLIENT_ID");
export const HL_CLIENT_SECRET = defineSecret("HL_CLIENT_SECRET");
export const TOKEN_ENC_KEY = defineSecret("TOKEN_ENC_KEY");
