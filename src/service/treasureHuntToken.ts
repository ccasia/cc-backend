import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// Redemption tokens are 256 bits of entropy, url-safe base64. Only the SHA-256
// hash is used for DB lookup; the plaintext is never stored, only an encrypted
// copy for Bitly retry/recovery.
export const generateHuntToken = () => {
  const value = randomBytes(32).toString('base64url');
  return { value, hash: createHash('sha256').update(value).digest('hex') };
};

const deriveKey = (key: string): Buffer => {
  // Accept a 64-char hex key directly, otherwise derive 32 bytes via SHA-256 so
  // any sufficiently-random secret works.
  if (/^[a-f0-9]{64}$/i.test(key)) return Buffer.from(key, 'hex');
  return createHash('sha256').update(key).digest();
};

export const createTokenCipher = ({ key }: { key: string }) => {
  const keyBuffer = deriveKey(key);

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', keyBuffer, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
    },

    decrypt(ciphertext: string): string {
      const [ivHex, authTagHex, dataHex] = ciphertext.split(':');
      if (!ivHex || !authTagHex || !dataHex) {
        throw new Error('Malformed treasure hunt token ciphertext.');
      }
      const decipher = createDecipheriv('aes-256-gcm', keyBuffer, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
    },
  };
};
