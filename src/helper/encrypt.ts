import crypto from 'crypto';

const secretKey: string = process.env.ENCRYPTION_KEY as string;

export const encryptToken = (token: string): any => {
  const key = crypto.createHash('sha256').update(secretKey).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  console.log('cypher', cipher);
  const encryptedToken = Buffer.concat([cipher.update(token), cipher.final()]);

  console.log('encryptedToken', encryptedToken);
  return { iv: iv.toString('hex'), content: encryptedToken.toString('hex') };
};

export const decryptToken = (encryptedData: { iv: string; content: string }): string => {
  const { iv, content } = encryptedData;

  const key = crypto.createHash('sha256').update(secretKey).digest();

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'hex'));
  const decryptedToken = Buffer.concat([decipher.update(Buffer.from(content, 'hex')), decipher.final()]);
  return decryptedToken.toString();
};
