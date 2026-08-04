const BITLY_API_BASE = 'https://api-ssl.bitly.com/v4';

export type BitlyErrorCode = 'UPGRADE_REQUIRED' | 'RATE_LIMITED' | 'UNAVAILABLE';

export class BitlyError extends Error {
  constructor(
    public code: BitlyErrorCode,
    public retryable: boolean,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'BitlyError';
  }
}

export interface BitlyConfig {
  accessToken: string;
  groupGuid: string;
}

interface BitlyHttp {
  post(url: string, body: unknown, options: unknown): Promise<{ status: number; data: any }>;
  get(url: string, options: unknown): Promise<{ status: number; data: any; headers?: any }>;
}

export interface BitlyQrImage {
  data: Buffer;
  contentType: string;
}

// [\s\S] rather than the `s` flag: the tsconfig target predates es2018.
const DATA_URI = /^data:([^;,]+);base64,([\s\S]+)$/;

/**
 * Bitly's GET /qr-codes/{id}/image answers with JSON wrapping a base64 data URI
 * — it does NOT stream raw image bytes. Reading the response as an arraybuffer
 * and storing it verbatim writes the JSON envelope to the bucket under an image
 * name, which then renders as a blank page everywhere. Decode it here so the
 * bytes that reach storage are the actual image, with its real content type
 * (Bitly currently returns SVG, which is what you want for print anyway).
 */
export const parseQrImagePayload = (payload: any): BitlyQrImage => {
  const encoded = typeof payload?.qr_code_image === 'string' ? payload.qr_code_image.trim() : '';
  if (!encoded) {
    throw new BitlyError('UNAVAILABLE', true, 'Bitly returned no QR image.');
  }

  const match = DATA_URI.exec(encoded);
  if (!match) {
    throw new BitlyError('UNAVAILABLE', true, 'Bitly returned an unreadable QR image.');
  }

  return { data: Buffer.from(match[2], 'base64'), contentType: match[1] };
};

const mapBitlyError = (error: any): BitlyError => {
  const status = error?.response?.status;
  if (status === 402) {
    return new BitlyError('UPGRADE_REQUIRED', false, 'Bitly plan does not permit this operation.');
  }
  if (status === 429) {
    const retryAfterRaw = error?.response?.headers?.['retry-after'];
    const retryAfterSeconds = retryAfterRaw ? Number(retryAfterRaw) : undefined;
    return new BitlyError('RATE_LIMITED', true, 'Bitly rate limit reached.', retryAfterSeconds);
  }
  return new BitlyError('UNAVAILABLE', true, 'Bitly is temporarily unavailable.');
};

export const createBitlyClient = ({ http, config }: { http: BitlyHttp; config: BitlyConfig }) => {
  const authHeaders = { headers: { Authorization: `Bearer ${config.accessToken}` } };

  return {
    async createBitlink({ longUrl, title }: { longUrl: string; title: string }) {
      try {
        const { data } = await http.post(
          `${BITLY_API_BASE}/bitlinks`,
          { long_url: longUrl, group_guid: config.groupGuid, title },
          authHeaders,
        );
        return { bitlinkId: data.id as string, bitlinkUrl: data.link as string };
      } catch (error) {
        throw mapBitlyError(error);
      }
    },

    async createQrCode({ bitlinkId, title }: { bitlinkId: string; title: string }) {
      try {
        const { data } = await http.post(
          `${BITLY_API_BASE}/qr-codes`,
          { group_guid: config.groupGuid, title, destination: { bitlink_id: bitlinkId } },
          authHeaders,
        );
        return { qrCodeId: (data.qrcode_id ?? data.id) as string };
      } catch (error) {
        throw mapBitlyError(error);
      }
    },

    async downloadQrImage({ qrCodeId }: { qrCodeId: string }): Promise<BitlyQrImage> {
      let payload: unknown;
      try {
        const response = await http.get(`${BITLY_API_BASE}/qr-codes/${qrCodeId}/image`, authHeaders);
        payload = response.data;
      } catch (error) {
        throw mapBitlyError(error);
      }
      // Parsing sits outside the try so a malformed-payload BitlyError is not
      // rewritten into a generic UNAVAILABLE by mapBitlyError.
      return parseQrImagePayload(payload);
    },

    async getQrScanCount({ qrCodeId }: { qrCodeId: string }): Promise<number> {
      try {
        const { data } = await http.get(`${BITLY_API_BASE}/qr-codes/${qrCodeId}/scans`, authHeaders);
        // Bitly returns per-unit metrics; sum the values defensively.
        const units: { value?: number }[] = data?.qr_code_scans ?? data?.link_clicks ?? [];
        return units.reduce((total, unit) => total + (unit.value ?? 0), 0);
      } catch (error) {
        throw mapBitlyError(error);
      }
    },
  };
};

export type BitlyClient = ReturnType<typeof createBitlyClient>;
