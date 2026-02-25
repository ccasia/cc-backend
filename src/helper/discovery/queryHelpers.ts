export type PlatformFilter = 'all' | 'instagram' | 'tiktok';

export const normalizePagination = (page = 1, limit = 20) => {
  const safePage = Number.isNaN(page) || page < 1 ? 1 : page;
  const safeLimit = Number.isNaN(limit) || limit < 1 ? 20 : Math.min(limit, 100);

  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
  };
};

export const normalizePlatform = (platform?: string): PlatformFilter => {
  if (platform === 'instagram' || platform === 'tiktok') {
    return platform;
  }

  return 'all';
};

export const genderToPronounce = (gender?: string): string | null => {
  if (!gender) return null;
  const map: Record<string, string> = {
    Male: 'He/Him',
    Female: 'She/Her',
    'Non-Binary': 'They/Them',
  };
  return map[gender] || null;
};

export const ageRangeToBirthDateRange = (ageRange?: string): { gte: Date; lte: Date } | null => {
  if (!ageRange) return null;
  const parts = ageRange.split('-');
  if (parts.length !== 2) return null;

  const minAge = parseInt(parts[0], 10);
  const maxAge = parseInt(parts[1], 10);
  if (Number.isNaN(minAge) || Number.isNaN(maxAge)) return null;

  const today = new Date();
  const latestBirth = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());
  const earliestBirth = new Date(today.getFullYear() - maxAge - 1, today.getMonth(), today.getDate() + 1);

  return { gte: earliestBirth, lte: latestBirth };
};

export const extractHashtags = (raw?: string): string[] => {
  if (!raw) return [];

  const tokens = raw
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/^#+/, '').toLowerCase())
    .filter(Boolean)
    .map((token) => `#${token}`);

  return Array.from(new Set(tokens));
};

export const normalizeKeywordTerm = (value?: string | null) =>
  (value || '')
    .trim()
    .toLowerCase()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\s+/g, ' ');

const normalizeContentText = (value?: string | null) =>
  (value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const normalizeKeywordComparableText = (value?: string | null) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasBoundaryTerm = (text: string, term: string) => {
  const pattern = `(^|\\s)${escapeRegex(term)}(\\s|$)`;
  return new RegExp(pattern).test(text);
};

const parseKeywordWords = (keywordTerm?: string) => {
  if (!keywordTerm) return [] as string[];

  const commaSeparated = keywordTerm
    .split(',')
    .map((term) => normalizeKeywordComparableText(term))
    .filter(Boolean);

  if (commaSeparated.length > 1) {
    return commaSeparated;
  }

  return normalizeKeywordComparableText(keywordTerm)
    .split(' ')
    .map((term) => term.trim())
    .filter(Boolean);
};

const hasKeywordPhraseMatch = (text: string, keywordTerm?: string) => {
  if (!keywordTerm) return true;
  const normalizedText = normalizeKeywordComparableText(text);
  const normalizedKeyword = normalizeKeywordComparableText(keywordTerm);

  if (!normalizedKeyword) return true;
  if (!normalizedText) return false;

  return hasBoundaryTerm(normalizedText, normalizedKeyword);
};

export const matchesContentTerms = (texts: string[], options: { keywordTerm?: string; hashtagTerms: string[] }) => {
  const normalizedTexts = (texts || []).map((text) => normalizeContentText(text));

  const keywordTerms = parseKeywordWords(options.keywordTerm);

  const keywordMatches =
    !options.keywordTerm ||
    normalizedTexts.some((text) => hasKeywordPhraseMatch(text, options.keywordTerm)) ||
    keywordTerms.every((term) =>
      normalizedTexts.some((text) => {
        const normalizedText = normalizeKeywordComparableText(text);
        return hasBoundaryTerm(normalizedText, term);
      }),
    );

  const hashtagMatches =
    options.hashtagTerms.length === 0 ||
    options.hashtagTerms.every((tag) => normalizedTexts.some((text) => text.includes(tag)));

  return keywordMatches && hashtagMatches;
};
