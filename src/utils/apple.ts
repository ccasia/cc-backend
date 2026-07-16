import appleSignin from 'apple-signin-auth';

/**
 * Apple Sign In token exchange + revocation helpers.
 *
 * Full account-deletion compliance (App Store guideline 5.1.1(v)) requires
 * revoking the user's Apple token on delete. Revocation needs Apple's *refresh*
 * token, which we obtain by exchanging the one-time `authorizationCode` the app
 * receives during sign-in. We persist that refresh token on the user and revoke
 * it at deletion time.
 *
 * Required env (Apple Developer portal):
 * - APPLE_CLIENT_ID    the app/Services ID used as the OAuth client_id
 * - APPLE_TEAM_ID      your 10-char Apple Developer Team ID
 * - APPLE_KEY_ID       the Key ID of the Sign in with Apple .p8 key
 * - APPLE_PRIVATE_KEY  the .p8 private key contents (PEM, newlines preserved)
 */

const clientID = () => process.env.APPLE_CLIENT_ID || process.env.APPLE_BUNDLE_ID!.split(',')[0].trim();

// The .p8 is commonly stored in .env with literal "\n" sequences; restore them.
const privateKey = () => (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const appleConfigured = (): boolean =>
  Boolean(process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY);

const buildClientSecret = (): string =>
  appleSignin.getClientSecret({
    clientID: clientID(),
    teamID: process.env.APPLE_TEAM_ID!,
    keyIdentifier: process.env.APPLE_KEY_ID!,
    privateKey: privateKey(),
  });

/**
 * Exchange the one-time authorizationCode from the native sign-in for an Apple
 * refresh token. Returns null (never throws) if credentials aren't configured
 * or the exchange fails — sign-in must not break just because revoke isn't set up.
 */
export const exchangeAppleRefreshToken = async (authorizationCode: string): Promise<string | null> => {
  if (!appleConfigured()) return null;
  try {
    const tokens = await appleSignin.getAuthorizationToken(authorizationCode, {
      clientID: clientID(),
      // Native (app) auth has no redirect; Apple accepts an empty string here.
      redirectUri: '',
      clientSecret: buildClientSecret(),
    });
    return tokens.refresh_token || null;
  } catch (e) {
    console.error('Apple authorizationCode exchange failed:', e);
    return null;
  }
};

/**
 * Revoke a stored Apple refresh token. Best-effort — logs and swallows failure
 * so account deletion is never blocked by Apple being unreachable.
 */
export const revokeAppleToken = async (refreshToken: string): Promise<void> => {
  if (!appleConfigured()) return;
  try {
    await appleSignin.revokeAuthorizationToken(refreshToken, {
      clientID: clientID(),
      clientSecret: buildClientSecret(),
      tokenTypeHint: 'refresh_token',
    });
  } catch (e) {
    console.error('Apple token revoke failed (non-blocking):', e);
  }
};
