import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { URL } from 'node:url';

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  domain: string;
}

interface CacheEntry {
  expiresAt: number;
  value: LinkPreview | null;
}

interface SafeFetchResult {
  response: Response;
  url: string;
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 256 * 1024;
const MAX_REDIRECTS = 4;
const previewCache = new Map<string, CacheEntry>();

function normalizePreviewUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function domainFor(urlString: string) {
  try {
    return new URL(urlString).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function isLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local');
}

function isPrivateIpv4(ip: string) {
  const octets = ip.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(ip: string) {
  const normalized = ip.toLowerCase();
  const mappedIpv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4[1]);

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.')
  );
}

function isPrivateIp(ip: string) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true;
}

async function assertPublicHttpUrl(urlString: string) {
  const url = new URL(urlString);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported URL protocol');
  if (url.username || url.password) throw new Error('URL credentials are not allowed');
  if (isLocalHostname(url.hostname)) throw new Error('Local hostnames are not allowed');

  const addresses = await lookup(url.hostname, { all: true, verbatim: false });
  if (addresses.length === 0 || addresses.some((address) => isPrivateIp(address.address))) {
    throw new Error('Private network addresses are not allowed');
  }
}

async function safeFetch(urlString: string, signal: AbortSignal, redirectCount = 0): Promise<SafeFetchResult> {
  await assertPublicHttpUrl(urlString);

  const response = await fetch(urlString, {
    redirect: 'manual',
    signal,
    headers: {
      accept: 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5',
      'user-agent': 'Cult Creative Link Preview Bot/1.0',
    },
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) return { response, url: urlString };
    if (redirectCount >= MAX_REDIRECTS) throw new Error('Too many redirects');
    const nextUrl = new URL(location, urlString).toString();
    return safeFetch(nextUrl, signal, redirectCount + 1);
  }

  return { response, url: urlString };
}

function readMetaAttributes(tag: string) {
  const attrs: Record<string, string> = {};
  const attrPattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(tag)) !== null) {
    const key = match[1].toLowerCase();
    attrs[key] = match[2] ?? match[3] ?? match[4] ?? '';
  }

  return attrs;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanText(value: string | undefined) {
  if (!value) return null;
  const cleaned = decodeHtmlEntities(value.replace(/\s+/g, ' ').trim());
  return cleaned.length > 0 ? cleaned : null;
}

function metaContent(html: string, matcher: (attrs: Record<string, string>) => boolean) {
  const metaPattern = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaPattern.exec(html)) !== null) {
    const attrs = readMetaAttributes(match[0]);
    if (matcher(attrs)) return cleanText(attrs.content);
  }

  return null;
}

function firstMetaByProperty(html: string, values: string[]) {
  const accepted = new Set(values.map((value) => value.toLowerCase()));
  return metaContent(html, (attrs) => accepted.has((attrs.property ?? attrs.name ?? '').toLowerCase()));
}

function htmlTitle(html: string) {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return cleanText(match?.[1]);
}

async function safeImageUrl(value: string | null, baseUrl: string) {
  if (!value) return null;

  try {
    const imageUrl = new URL(value, baseUrl);
    if (imageUrl.protocol !== 'http:' && imageUrl.protocol !== 'https:') return null;
    await assertPublicHttpUrl(imageUrl.toString());
    return imageUrl.toString();
  } catch {
    return null;
  }
}

async function readPreviewHtml(response: Response) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_HTML_BYTES) return null;
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;

  while (received < MAX_HTML_BYTES) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    const remaining = MAX_HTML_BYTES - received;
    const chunk = value.length > remaining ? value.slice(0, remaining) : value;
    chunks.push(Buffer.from(chunk));
    received += chunk.length;

    if (received >= MAX_HTML_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function previewFromHtml(html: string, finalUrl: string): Promise<LinkPreview | null> {
  const title = firstMetaByProperty(html, ['og:title', 'twitter:title']) ?? htmlTitle(html);
  const description = firstMetaByProperty(html, ['og:description', 'twitter:description', 'description']) ?? null;
  const rawImage = firstMetaByProperty(html, ['og:image:secure_url', 'og:image', 'twitter:image']);
  const image = await safeImageUrl(rawImage, finalUrl);
  const siteName = firstMetaByProperty(html, ['og:site_name', 'twitter:site']) ?? null;
  const domain = domainFor(finalUrl);

  if (!title && !description && !image) return null;

  return {
    url: finalUrl,
    title,
    description,
    image,
    siteName,
    domain,
  };
}

function previewFromImage(finalUrl: string): LinkPreview {
  const domain = domainFor(finalUrl);
  return {
    url: finalUrl,
    title: domain || null,
    description: null,
    image: finalUrl,
    siteName: null,
    domain,
  };
}

export async function getLinkPreviewForUrl(input: string): Promise<LinkPreview | null> {
  const normalized = normalizePreviewUrl(input);
  if (!normalized) return null;

  const cached = previewCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const { response, url } = await safeFetch(normalized, controller.signal);
    const finalUrl = normalizePreviewUrl(url);
    if (!finalUrl || !response.ok) return null;

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const preview = contentType.startsWith('image/')
      ? previewFromImage(finalUrl)
      : contentType.includes('text/html') || contentType.includes('application/xhtml+xml')
        ? await previewFromHtml((await readPreviewHtml(response)) ?? '', finalUrl)
        : null;

    previewCache.set(normalized, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: preview,
    });

    return preview;
  } catch {
    previewCache.set(normalized, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: null,
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
