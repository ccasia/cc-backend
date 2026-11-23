import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

export const INSIGHT_OCR_MODEL = 'claude-haiku-5-5';

// Claude Haiku 5.5 rates for prompts up to 100K tokens. One screenshot is a few thousand tokens.
const PRICE_PER_MILLION = { input: 0.1, output: 0.5 };

// Claude Haiku 5.5 is on the high-resolution image tier.
const MAX_IMAGE_EDGE = 2576;
const MAX_IMAGE_TOKENS = 4784;

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
- box: [x1, y1, x2, y2] in pixel coordinates of the image (top-left and bottom-right corners), tightly around the VALUE text only

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
  type: 'object',
  additionalProperties: false,
  required: ['platform', 'screen', 'fields'],
  properties: {
    platform: { type: 'string', enum: ['instagram', 'tiktok', 'unknown'] },
    screen: { type: 'string', enum: ['overview', 'engagement', 'audience', 'other'] },
    fields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'label', 'value', 'box'],
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          value: { type: 'string' },
          box: {
            type: 'array',
            description: '[x1, y1, x2, y2] in pixels of the image',
            items: { type: 'number' },
          },
        },
      },
    },
  },
};

let client: Anthropic | null = null;

export const isInsightOcrConfigured = () => !!process.env.ANTHROPIC_API_KEY;

const getClient = () => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  // A key that is not scoped to a workspace must name one on every request.
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  client ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: 90_000,
    maxRetries: 2,
    ...(workspaceId && { defaultHeaders: { 'anthropic-workspace-id': workspaceId } }),
  });
  return client;
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

// The size Claude scales an image to (docs: vision-coordinates, "How Claude resizes and pads images").
const roundHalfEven = (value: number) => {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
};

const fitsModel = (width: number, height: number) =>
  Math.ceil(width / 28) * 28 <= MAX_IMAGE_EDGE &&
  Math.ceil(height / 28) * 28 <= MAX_IMAGE_EDGE &&
  Math.ceil(width / 28) * Math.ceil(height / 28) <= MAX_IMAGE_TOKENS;

export const modelImageSize = (width: number, height: number): [number, number] => {
  if (fitsModel(width, height)) return [width, height];
  if (height > width) {
    const [h, w] = modelImageSize(height, width);
    return [w, h];
  }
  const aspectRatio = width / height;
  let lo = 1;
  let hi = width;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fitsModel(mid, Math.max(roundHalfEven(mid / aspectRatio), 1))) lo = mid;
    else hi = mid;
  }
  return [lo, Math.max(roundHalfEven(lo / aspectRatio), 1)];
};

/**
 * Turns the photo upright and scales it to the size Claude reads, so the pixel boxes Claude returns
 * line up with the image we send. Images that already fit are sent unchanged.
 */
const prepareImage = async (data: Buffer) => {
  const meta = await sharp(data).metadata();
  const orientation = meta.orientation ?? 1;
  const sideways = orientation >= 5;
  const width = (sideways ? meta.height : meta.width) ?? 0;
  const height = (sideways ? meta.width : meta.height) ?? 0;
  if (!width || !height) throw new Error('Could not read the image size');

  const [targetWidth, targetHeight] = modelImageSize(width, height);
  if (orientation === 1 && targetWidth === width && targetHeight === height) return { data, width, height };

  const resized = await sharp(data).rotate().resize(targetWidth, targetHeight).toBuffer();
  return { data: resized, width: targetWidth, height: targetHeight };
};

// Claude returns [x1, y1, x2, y2] in pixels. The app stores [ymin, xmin, ymax, xmax] on a 0-1000 scale.
export const toBox = (box: unknown, width: number, height: number): InsightField['box'] => {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const nums = box.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;

  const clampX = (x: number) => Math.min(width, Math.max(0, x));
  const clampY = (y: number) => Math.min(height, Math.max(0, y));
  const [x1, x2] = [clampX(nums[0]), clampX(nums[2])].sort((a, b) => a - b);
  const [y1, y2] = [clampY(nums[1]), clampY(nums[3])].sort((a, b) => a - b);
  const scale = (value: number, size: number) => Math.round((value / size) * 1000);

  return [scale(y1, height), scale(x1, width), scale(y2, height), scale(x2, width)];
};

const errorMessage = (error: unknown) => {
  if (error instanceof Anthropic.APIError) return `Claude API error ${error.status ?? ''}: ${error.message}`;
  return (error as Error).message;
};

export const extractInsightsFromImage = async ({
  fileName,
  mimeType,
  data,
}: {
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
    const image = await prepareImage(data);

    const response = await getClient().messages.create({
      model: INSIGHT_OCR_MODEL,
      max_tokens: 16000,
      system: PROMPT,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType as Anthropic.Base64ImageSource['media_type'],
                data: image.data.toString('base64'),
              },
              // We already scaled it. An error is better than a silent resize that moves every box.
              transformations: { oversized_image: 'error' },
            },
            { type: 'text', text: `This screenshot is ${image.width}x${image.height} pixels. Read its insights.` },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(`Claude declined to read this screenshot (${response.stop_details?.category ?? 'no reason'})`);
    }
    if (response.stop_reason === 'max_tokens') throw new Error('The reply was cut off before it finished');

    const text = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text')?.text;
    if (!text) throw new Error('Claude returned no content');

    const parsed = JSON.parse(text);
    const { input_tokens: inputTokens, output_tokens: outputTokens } = response.usage;

    return {
      fileName,
      platform: ['instagram', 'tiktok'].includes(parsed.platform) ? parsed.platform : 'unknown',
      screen: parsed.screen || 'other',
      fields: (parsed.fields || []).map((f: { key: string; label: string; value: string; box: unknown }) => ({
        key: f.key,
        label: f.label,
        value: f.value,
        number: parseInsightNumber(f.value),
        box: toBox(f.box, image.width, image.height),
      })),
      usage: {
        inputTokens,
        outputTokens,
        costUsd: (inputTokens * PRICE_PER_MILLION.input + outputTokens * PRICE_PER_MILLION.output) / 1_000_000,
      },
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = errorMessage(error);
    console.warn(`Insight OCR could not read ${fileName}: ${message}`);
    return { ...empty, durationMs: Date.now() - startedAt, error: message };
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
