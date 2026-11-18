export const INSIGHT_OCR_MODEL = 'gemini-3.5-flash-lite';

const PRICE_PER_MILLION = { input: 0.3, output: 2.5 };

export interface InsightField {
  key: string;
  label: string;
  value: string;
  number: number | null;
  box: [number, number, number, number] | null;
}

export type InsightPlatform = 'instagram' | 'tiktok';

export interface InsightImageResult {
  fileName: string;
  platform: InsightPlatform | 'unknown';
  screen: string;
  fields: InsightField[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  durationMs: number;
  error?: string;
}

const PROMPT = `You read one screenshot of the insights of one post. It is from Instagram (Reel or post insights) or from TikTok (Video analysis in TikTok Studio). Return the platform and every metric value visible on it.

platform: "instagram" or "tiktok". Use "unknown" only if you cannot tell.
screen: "overview" (Instagram Overview, TikTok Overview), "engagement" (Instagram Engagement, TikTok Engagement), "audience" (Instagram Audience, TikTok Viewers) or "other".

For each metric return:
- key: snake_case key from the list below
- label: the label as shown on screen
- value: the value exactly as shown (for example "1,234", "9s", "57.5%", "16h:48m:08s")
- box_2d: [ymin, xmin, ymax, xmax] normalized to 0-1000, tightly around the VALUE text only

Keys (both platforms):
- views, viewers, avg_watch_time, total_play_time, follows (also "New followers"), profile_visits
- likes, comments, reposts, shares, saves
- skip_rate, share_rate, like_rate, save_rate, repost_rate, comment_rate, full_watch_rate ("Watched full video")
- followers_pct, non_followers_pct, new_viewers_pct, returning_viewers_pct
- view sources: source_<name> (source_feed, source_stories, source_reels_tab, source_profile, source_explore, source_search, source_for_you, source_personal_profile, source_following, source_sound, source_other)
- search queries: search_query_<rank>, where rank is the row number from the top (search_query_1, search_query_2, ...). The label is the search term exactly as shown: same capital letters, spaces and hyphens.
- age: age_<range> (age_13_17, age_18_24, age_25_34, age_35_44, age_45_54, age_55_64, age_55_plus, age_65_plus)
- country (also "Locations"): country_<name> (country_malaysia, country_indonesia, country_united_states)
- gender: gender_men ("Male"), gender_women ("Female"), gender_other

Icon rows have no text labels. Use these keys and label them "Likes (icon)", "Comments (icon)", and so on.
- Instagram, the row of 5 counts under the reel thumbnail, left to right:
  heart = likes, speech bubble = comments, two arrows = reposts, paper plane = shares, bookmark = saves.
- TikTok, the row of 5 counts under the video thumbnail, left to right:
  play = views, heart = likes, speech bubble = comments, curved arrow = shares, bookmark = saves.
  On TikTok the curved arrow is shares, not reposts.

Rules:
- Do not read chart axis labels (for example 2K, 1K, 100%, 50%, 0:00, 0:24, 00:35).
- Do not read the status bar (time, battery), the posting date, the video length on the thumbnail, or "vs 1d ago" changes.
- If the same metric is visible two times, return both.
- Never guess a value that is not visible.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    platform: { type: 'STRING', enum: ['instagram', 'tiktok', 'unknown'] },
    screen: { type: 'STRING', enum: ['overview', 'engagement', 'audience', 'other'] },
    fields: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING' },
          label: { type: 'STRING' },
          value: { type: 'STRING' },
          box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
        },
        required: ['key', 'label', 'value', 'box_2d'],
      },
    },
  },
  required: ['platform', 'screen', 'fields'],
};

// "16h:48m:08s", "1m 5s" or "2h" -> seconds. Plain "8.8s" stays with parseInsightNumber.
const parseDuration = (value: string): number | null => {
  const match = value.trim().match(/^(?:(\d+)\s*h)?[\s:]*(?:(\d+)\s*m)?[\s:]*(?:(\d+(?:\.\d+)?)\s*s)?$/i);
  if (!match || (!match[1] && !match[2])) return null;
  const [hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  return hours * 3600 + minutes * 60 + seconds;
};

export const parseInsightNumber = (value: string): number | null => {
  const duration = parseDuration(value);
  if (duration !== null) return duration;

  const match = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!match) return null;

  const base = parseFloat(match[0]);
  const suffix = value.trim().slice(-1).toUpperCase();
  if (suffix === 'K') return base * 1_000;
  if (suffix === 'M') return base * 1_000_000;
  return base;
};

const toBox = (box: unknown): InsightField['box'] => {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const nums = box.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums.map((n) => Math.min(1000, Math.max(0, n))) as InsightField['box'];
};

export const extractInsightsFromImage = async ({
  apiKey,
  fileName,
  mimeType,
  data,
}: {
  apiKey: string;
  fileName: string;
  mimeType: string;
  data: Buffer;
}): Promise<InsightImageResult> => {
  const startedAt = Date.now();
  const empty = {
    fileName,
    platform: 'unknown' as const,
    screen: 'other',
    fields: [],
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${INSIGHT_OCR_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ inlineData: { mimeType, data: data.toString('base64') } }, { text: PROMPT }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
            maxOutputTokens: 8192,
          },
        }),
      },
    );

    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message || `Gemini request failed (${res.status})`);

    const text = body?.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text;
    if (!text) throw new Error('Gemini returned no content');

    const parsed = JSON.parse(text);
    const meta = body.usageMetadata || {};
    const inputTokens = meta.promptTokenCount || 0;
    const outputTokens = (meta.candidatesTokenCount || 0) + (meta.thoughtsTokenCount || 0);

    return {
      fileName,
      platform: ['instagram', 'tiktok'].includes(parsed.platform) ? parsed.platform : 'unknown',
      screen: parsed.screen || 'other',
      fields: (parsed.fields || []).map((f: { key: string; label: string; value: string; box_2d: unknown }) => ({
        key: f.key,
        label: f.label,
        value: f.value,
        number: parseInsightNumber(f.value),
        box: toBox(f.box_2d),
      })),
      usage: {
        inputTokens,
        outputTokens,
        costUsd: (inputTokens * PRICE_PER_MILLION.input + outputTokens * PRICE_PER_MILLION.output) / 1_000_000,
      },
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.warn(`Insight OCR could not read ${fileName}: ${(error as Error).message}`);
    return { ...empty, durationMs: Date.now() - startedAt, error: (error as Error).message };
  }
};

// "6.8K" and "6,779" are the same value shown with different rounding.
const isRounded = (value: string) => /\d\s*[KM]\s*$/i.test(value);
const sameValue = (a: number, b: number) => a === b || Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 0.01;

// One value per key across screenshots. The first value wins, but an exact value replaces a rounded one.
// A different number later is a conflict.
export const combineInsightValues = (images: Pick<InsightImageResult, 'fields'>[]) => {
  const values: Record<string, number | string> = {};
  const rounded = new Set<string>();
  const conflictKeys = new Set<string>();

  images.forEach((image) =>
    image.fields.forEach((field) => {
      const value = field.number ?? field.value;
      const current = values[field.key];

      if (!(field.key in values)) {
        values[field.key] = value;
        if (isRounded(field.value)) rounded.add(field.key);
        return;
      }
      if (typeof value !== 'number' || typeof current !== 'number') return;

      if (!sameValue(current, value)) conflictKeys.add(field.key);
      else if (rounded.has(field.key) && !isRounded(field.value)) {
        values[field.key] = value;
        rounded.delete(field.key);
      }
    }),
  );

  return { values, conflicts: conflictKeys.size };
};
