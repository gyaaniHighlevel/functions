import {
  FirestoreDataConverter,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";

export function converter<T extends FirebaseFirestore.DocumentData>():
  FirestoreDataConverter<T> {
  return {
    toFirestore: (data) => data as FirebaseFirestore.DocumentData,
    fromFirestore: (snap: QueryDocumentSnapshot) => snap.data() as T,
  };
}
