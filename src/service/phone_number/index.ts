import { PHONE_CODES } from '@/src/constants/countryCodes';
import parsePhoneNumberFromString, { CountryCode } from 'libphonenumber-js';

export type PhoneNormalizeResult =
  | { status: 'valid'; e164: string; country: CountryCode }
  | { status: 'invalid'; original: string; reason: string };

const DEFAULT_REGION: CountryCode = 'MY'; // fallback when no hint is available

export function normalizePhone(
  raw: string,
  regionHint?: CountryCode, // pass user's known country if you have one
): PhoneNormalizeResult {
  if (!raw) return { status: 'invalid', original: raw, reason: 'empty' };

  let cleaned = raw.trim().replace(/[^\d+]/g, '');

  if (/[^\d+]/.test(cleaned)) {
    return { status: 'invalid', original: raw, reason: 'contains non-numeric characters' };
  }

  // Normalize "00" international prefix (common outside NANP) -> "+"
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);

  // Case 1: has + or 00 prefix -> let the lib auto-detect country
  if (cleaned.startsWith('+')) {
    const parsed = parsePhoneNumberFromString(cleaned);
    if (parsed?.isValid()) {
      return { status: 'valid', e164: parsed.number, country: parsed.country! };
    }
    return { status: 'invalid', original: raw, reason: 'invalid international number' };
  }

  // Case 2: no prefix -> try regionHint first, then default region
  const regionsToTry = [regionHint, DEFAULT_REGION].filter(
    (r, i, arr): r is CountryCode => !!r && arr.indexOf(r) === i,
  );

  for (const region of regionsToTry) {
    const parsed = parsePhoneNumberFromString(cleaned, region);
    if (parsed?.isValid()) {
      return { status: 'valid', e164: parsed.number, country: parsed.country! };
    }
  }

  return {
    status: 'invalid',
    original: raw,
    reason: `does not match a valid number in ${regionsToTry.join(' or ')}`,
  };
}

export function getCountryShortCode(country: string | null): CountryCode | undefined {
  if (!country) return;

  const shortCountryCode = PHONE_CODES.find((a) => a.country.toLowerCase().includes(country.toLowerCase()));

  return (shortCountryCode?.iso as unknown as CountryCode) ?? null;
}
