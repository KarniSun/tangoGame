// firebaseConfig.js
// ---------------------------------------------------------------------------
// Firebase config object ONLY — no logic here.
//
// Create a free Firebase project at https://firebase.google.com, add a Web app,
// enable Realtime Database, and paste the generated values below. The
// `databaseURL` is required for Realtime Database (it is not part of the default
// snippet for Firestore-only projects, so copy it from the Realtime Database
// page — it looks like https://<project-id>-default-rtdb.firebaseio.com).
//
// Suggested open-ish RTDB rules for this small-scale, account-less game:
//   { "rules": { "rooms": { "$room": { ".read": true, ".write": true } } } }
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: 'AIzaSyD23C35i7MJCOhUpNaJx94hN2ggliQKM80',
  authDomain: 'tango-duel.firebaseapp.com',
  databaseURL: 'https://tango-duel-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'tango-duel',
  storageBucket: 'tango-duel.firebasestorage.app',
  messagingSenderId: '475486391644',
  appId: '1:475486391644:web:20528e7b33aea7ca3f4599',
};

/** True once real keys have been pasted in (used to show a friendly warning). */
export function isFirebaseConfigured() {
  return !firebaseConfig.apiKey.startsWith('YOUR_');
}
