import crypto from 'crypto';

const secretKey: string = process.env.ENCRYPTION_KEY as string;

export const encryptToken = (token: string): any => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-ctr', secretKey, iv);
  const encryptedToken = Buffer.concat([cipher.update(token), cipher.final()]);
  return { iv: iv.toString('hex'), content: encryptedToken.toString('hex') };
};

export const decryptToken = (encryptedData: { iv: string; content: string }) => {
  const { iv, content } = encryptedData;
  const decipher = crypto.createDecipheriv('aes-256-ctr', secretKey, Buffer.from(iv, 'hex'));
  const decryptedToken = Buffer.concat([decipher.update(Buffer.from(content, 'hex')), decipher.final()]);
  return decryptedToken.toString();
};
