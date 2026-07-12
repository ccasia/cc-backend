import { OAuth2Client } from 'google-auth-library';

/**
 * Google Sign In ID-token verification for the MOBILE app.
 *
 * The native Google SDK (@react-native-google-signin) obtains an ID token on the
 * device; the app POSTs it to `/api/mobile/auth/google` and we verify it here,
 * mirroring how `apple.ts` verifies the Apple identity token. Unlike Apple there
 * is no token exchange / refresh-token step — Google does not require app-side
 * revocation on account deletion, so we only need the identity claims.
 *
 * Required env:
 * - GOOGLE_MOBILE_WEB_CLIENT_ID  the Web OAuth client ID. On Android the native
 *   SDK returns an ID token whose `aud` is the Web client, so this must be in the
 *   accepted-audience list.
 * - GOOGLE_IOS_CLIENT_ID (optional) the iOS OAuth client ID — included in the
 *   accepted audiences so iOS-issued tokens verify too.
 */

// A verifier client needs no credentials; it just fetches Google's public keys.
const client = new OAuth2Client();

const acceptedAudiences = (): string[] =>
  [process.env.GOOGLE_MOBILE_WEB_CLIENT_ID, process.env.GOOGLE_IOS_CLIENT_ID].filter(Boolean) as string[];

export type GoogleIdentity = {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
};

/**
 * Verify a Google ID token and return the identity claims. Throws if the token
 * is invalid, expired, or issued for an audience we don't accept — the caller
 * (googleLogin) turns that into a 401.
 */
export const verifyGoogleIdToken = async (idToken: string): Promise<GoogleIdentity> => {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: acceptedAudiences(),
  });

  const payload = ticket.getPayload();
  if (!payload?.sub) {
    throw new Error('Google ID token missing subject');
  }

  return {
    sub: payload.sub,
    email: payload.email,
    // Google sets email_verified; treat a missing flag as unverified.
    emailVerified: payload.email_verified === true,
    name: payload.name,
  };
};
