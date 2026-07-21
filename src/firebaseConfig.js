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
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  databaseURL: 'https://YOUR_PROJECT-default-rtdb.firebaseio.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

/** True once real keys have been pasted in (used to show a friendly warning). */
export function isFirebaseConfigured() {
  return !firebaseConfig.apiKey.startsWith('YOUR_');
}
