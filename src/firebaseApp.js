// firebaseApp.js
// ---------------------------------------------------------------------------
// One memoized Firebase app, shared by the two modules that need it:
// multiplayer.js (Realtime Database) and auth.js (Authentication). Calling
// initializeApp twice with the same config is an error, so this is the single
// place it happens.
//
// The SDK is loaded straight from the CDN as an ES module, so there is no build
// step. If you prefer, swap these URLs for locally-vendored copies.
// ---------------------------------------------------------------------------

import { firebaseConfig, isFirebaseConfigured } from './firebaseConfig.js?v=31';

export const SDK_VERSION = '10.12.2';
const APP_URL = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`;
const DB_URL = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-database.js`;

let appPromise = null;
let dbPromise = null;

/**
 * The shared FirebaseApp. Throws a clear error if the config is still the
 * placeholder, so callers can tell the user to paste their keys rather than
 * failing cryptically deeper in the SDK.
 */
export function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      if (!isFirebaseConfigured()) {
        throw new Error(
          'Firebase is not configured - paste your keys into src/firebaseConfig.js.'
        );
      }
      const { initializeApp } = await import(APP_URL);
      return initializeApp(firebaseConfig);
    })();
  }
  return appPromise;
}

/**
 * The shared Realtime Database, as `{ db, rtdb }` - the handle plus the SDK's
 * function bag. Both multiplayer.js (rooms) and wallet.js (account profiles)
 * go through here so the database is only ever set up once.
 */
export function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const app = await getApp();
      const rtdb = await import(DB_URL);
      return { db: rtdb.getDatabase(app), rtdb };
    })();
  }
  return dbPromise;
}
