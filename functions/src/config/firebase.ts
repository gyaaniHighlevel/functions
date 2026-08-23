import {setGlobalOptions} from "firebase-functions/v2";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";

if (getApps().length === 0) {
  initializeApp();
}

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
});

export const db = getFirestore();
