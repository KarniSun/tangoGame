// auth.js
// ---------------------------------------------------------------------------
// The ONLY module that talks to Firebase Authentication. Google sign-in plus
// email/password, and nothing else - password hashing, reset mails, token
// refresh and session persistence are all Firebase's problem, not ours.
//
// Firebase defaults to local persistence, so a signed-in session survives
// reloads and browser restarts with no work here.
//
// Signing in is entirely optional: the game is fully playable as a guest, and
// this module is only imported when someone actually opens the account screen.
// That keeps solo mode free of any Firebase dependency.
// ---------------------------------------------------------------------------

import { getApp, SDK_VERSION } from './firebaseApp.js';

const AUTH_URL = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`;

let auth = null;
let sdk = null;

async function ensureAuth() {
  if (auth) return auth;
  const app = await getApp();
  sdk = await import(AUTH_URL);
  auth = sdk.getAuth(app);
  return auth;
}

/**
 * Turn Firebase's error codes into something a human can act on. The default
 * messages leak SDK jargon ("auth/invalid-credential") that means nothing to a
 * player who simply mistyped their password.
 */
function friendlyError(err) {
  const code = (err && err.code) || '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That does not look like a valid email address.';
    case 'auth/missing-password':
      return 'Please enter a password.';
    case 'auth/weak-password':
      return 'Password needs to be at least 6 characters.';
    case 'auth/email-already-in-use':
      return 'That email already has an account - try signing in instead.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Wrong email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup. Allow popups and retry.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorised. Add it under Authentication > Settings > Authorized domains.';
    // Both mean "this sign-in method is switched off in the project" - the
    // single most likely error before anyone has enabled the providers.
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed':
      return 'Sign-in is not enabled yet. Turn on Google and Email/Password under Authentication > Sign-in method in the Firebase console.';
    default:
      return (err && err.message) || 'Something went wrong. Please try again.';
  }
}

/** Run an auth call, rethrowing with a message worth showing to a player. */
async function attempt(fn) {
  try {
    return await fn();
  } catch (err) {
    const e = new Error(friendlyError(err));
    e.code = err && err.code;
    throw e;
  }
}

/**
 * Subscribe to sign-in state. Fires immediately with the current user (or null)
 * and again on every change. Returns an unsubscribe function.
 */
export async function onAuthChange(callback) {
  await ensureAuth();
  return sdk.onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle() {
  await ensureAuth();
  const provider = new sdk.GoogleAuthProvider();
  return attempt(() => sdk.signInWithPopup(auth, provider));
}

/**
 * Full-page redirect sign-in. The popup flow silently fails on browsers that
 * block third-party cookies or enforce COOP - the popup opens and instantly
 * closes - so the caller falls back to this, which navigates away and back
 * instead of relying on a popup window.
 */
export async function signInWithGoogleRedirect() {
  await ensureAuth();
  const provider = new sdk.GoogleAuthProvider();
  return attempt(() => sdk.signInWithRedirect(auth, provider));
}

/** Finish a redirect sign-in after the page has navigated back. */
export async function completeRedirect() {
  await ensureAuth();
  return attempt(() => sdk.getRedirectResult(auth));
}

export async function signUpWithEmail(email, password) {
  await ensureAuth();
  return attempt(() => sdk.createUserWithEmailAndPassword(auth, email, password));
}

export async function signInWithEmail(email, password) {
  await ensureAuth();
  return attempt(() => sdk.signInWithEmailAndPassword(auth, email, password));
}

export async function sendPasswordReset(email) {
  await ensureAuth();
  return attempt(() => sdk.sendPasswordResetEmail(auth, email));
}

export async function signOutUser() {
  await ensureAuth();
  return attempt(() => sdk.signOut(auth));
}

export function currentUser() {
  return auth ? auth.currentUser : null;
}

/** A display name worth showing: the profile name, else the email's local part. */
export function displayNameOf(user) {
  if (!user) return '';
  if (user.displayName) return user.displayName;
  return user.email ? user.email.split('@')[0] : 'Player';
}
