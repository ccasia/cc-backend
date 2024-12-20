import { Request, Response } from 'express';

const TIKTOK_REDIRECT_URI = `https://staging.cultcreativeasia.com/api/social/tiktok/callback`;
const CLIENT_KEY = 'sbawx99tuchkscwygv';

const CODE_VERIFIER = 'your_unique_code_verifier';
const CODE_CHALLENGE = 'SHA256_hash_of_code_verifier';

export const redirectTiktok = (req: Request, res: Response) => {
  const csrfState = Math.random().toString(36).substring(2);
  res.cookie('csrfState', csrfState, { maxAge: 60000 });

  let url = 'https://www.tiktok.com/v2/auth/authorize/';

  url += '?client_key=' + CLIENT_KEY;
  url += '&scope=user.info.basic,user.info.profile,user.info.stats';
  url += '&response_type=code';
  url += '&redirect_uri=' + TIKTOK_REDIRECT_URI;
  url += '&state=' + csrfState;
  url += '&code_challenge=' + CODE_VERIFIER;
  url += '&code_challenge_method=S256';

  res.send(url);
};
