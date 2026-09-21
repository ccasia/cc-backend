import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';
import { PHONE_CODES } from '../constants/countryCodes';

export type PhoneNormalizeResult =
  | { status: 'valid'; e164: string; country: CountryCode }
  | { status: 'invalid'; original: string; reason: string };

const DEFAULT_REGION: CountryCode = 'MY';

export function normalizePhone(raw: string, regionHint?: CountryCode): PhoneNormalizeResult {
  if (!raw) return { status: 'invalid', original: raw, reason: 'empty' };

  let cleaned = raw.trim().replace(/[^\d+]/g, '');

  if (!cleaned) {
    return { status: 'invalid', original: raw, reason: 'contains no digits' };
  }

  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);

  if (cleaned.startsWith('+')) {
    const parsed = parsePhoneNumberFromString(cleaned);
    if (parsed?.isValid()) {
      return { status: 'valid', e164: parsed.number, country: parsed.country! };
    }
    return { status: 'invalid', original: raw, reason: 'invalid international number' };
  }

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
  if (!country) return undefined;

  const shortCountryCode = PHONE_CODES.find((a) =>
    a.country.toLowerCase().includes(country.toLowerCase()),
  );

  return (shortCountryCode?.iso as unknown as CountryCode) ?? undefined;
}
