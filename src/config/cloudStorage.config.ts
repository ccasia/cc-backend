import { Storage, TransferManager } from '@google-cloud/storage';
import dayjs from 'dayjs';
import fs from 'fs';

const pathToJSONKey = `${__dirname}/test-cs.json`;

export const storage = new Storage({
  keyFilename: pathToJSONKey,
});

export const uploadImage = async (tempFilePath: string, fileName: string, folderName: string) => {
  const uploadPromise = new Promise<string>((resolve, reject) => {
    storage.bucket(process.env.BUCKET_NAME as string).upload(
      tempFilePath,
      {
        destination: `${folderName}/${fileName}`,
        gzip: true,
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
      },
      (err, file) => {
        if (err) {
          reject(err);
          return;
        }
        // Making the file public and getting the public URL
        // eslint-disable-next-line promise/no-promise-in-callback
        file
          ?.makePublic()
          // eslint-disable-next-line promise/always-return
          .then(() => {
            const publicURL = `https://storage.googleapis.com/${process.env.BUCKET_NAME}/${folderName}/${fileName}?v=${dayjs().format()}`;
            resolve(publicURL);
          })
          .catch((err) => {
            reject(err);
          });
      },
    );
  });

  try {
    const publicURL = await uploadPromise;
    return publicURL;
  } catch (err) {
    throw new Error(`Error uploading file: ${err}`);
  }
};

// New function for chat attachments
export const uploadChatAttachment = async (
  tempFilePath: string, 
  fileName: string, 
  threadId: string,
  fileType: string
): Promise<{ url: string; originalName: string; fileType: string }> => {
  try {
    // Ensure unique filenames
    const uniqueFileName = `${dayjs().format('YYYYMMDDHHmmss')}-${fileName}`;
    const folderName = `chat-attachments/${threadId}`;
    
    const bucketName = process.env.BUCKET_NAME as string;
    const destination = `${folderName}/${uniqueFileName}`;

    // Upload the file to the specified bucket
    const [file] = await storage.bucket(bucketName).upload(tempFilePath, {
      destination,
      gzip: true,
      metadata: {
        contentType: fileType,
        metadata: {
          originalName: fileName,
          threadId: threadId
        }
      },
    });

    // Make the file public
    await file.makePublic();

    // Construct the public URL with a cache-busting parameter
    const publicURL = `https://storage.googleapis.com/${bucketName}/${destination}?v=${dayjs().format()}`;
    
    return {
      url: publicURL,
      originalName: fileName,
      fileType: fileType
    };
  } catch (err) {
    console.error("Error uploading chat attachment:", err);
    throw new Error(`Error uploading chat attachment: ${err.message}`);
  }
};

export const uploadProfileImage = async (tempFilePath: string, fileName: string, folderName: string) => {
  try {
    const bucket = storage.bucket(process.env.BUCKET_NAME as string);
    const destination = `${folderName}/${fileName}`;

    await bucket.upload(tempFilePath, {
      destination: destination,
      metadata: {
        cacheControl: 'public, max-age=31536000',
      },
    });

    // Construct the URL manually
    const publicUrl = `https://storage.googleapis.com/${process.env.BUCKET_NAME}/${destination}`;

    return publicUrl;
  } catch (err) {
    console.error('Error uploading file:', err);
    throw new Error(`Error uploading file: ${err.message}`);
  }
};

export const uploadCompanyLogo = async (tempFilePath: string, fileName: string) => {
  const uploadPromise = new Promise<string>((resolve, reject) => {
    storage.bucket(process.env.BUCKET_NAME as string).upload(
      tempFilePath,
      {
        destination: `companyLogo/${fileName}`,
        gzip: true,
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
      },
      (err, file) => {
        if (err) {
          reject(err);
          return;
        }
        // Making the file public and getting the public URL
        // eslint-disable-next-line promise/no-promise-in-callback
        file
          ?.makePublic()
          // eslint-disable-next-line promise/always-return
          .then(() => {
            const publicURL = `https://storage.googleapis.com/${process.env.BUCKET_NAME}/companyLogo/${fileName}`;
            resolve(publicURL);
          })
          .catch((err) => {
            reject(err);
          });
      },
    );
  });

  try {
    const publicURL = await uploadPromise;
    return publicURL;
  } catch (err) {
    throw new Error(`Error uploading file: ${err}`);
  }
};

export const uploadPitchVideo = async (
  tempFilePath: string,
  fileName: string,
  folderName: string,
  progressCallback?: (progress: number) => void,
  size?: number,
): Promise<string> => {
  try {
    const bucketName = process.env.BUCKET_NAME as string;
    const destination = `${folderName}/${fileName}`;

    await checkIfVideoExist(fileName, folderName);

    const bucket = storage.bucket(bucketName);
    const file = bucket.file(destination);

    // Create read and write streams
    const readStream = fs.createReadStream(tempFilePath);
    const writeStream = file.createWriteStream({
      resumable: true,
      metadata: { contentType: 'video/mp4' },
    });

    let uploadedBytes = 0;

    // Track progress
    readStream.on('data', (chunk) => {
      uploadedBytes += chunk.length;
      if (size) {
        const progress = ((uploadedBytes / size) * 100).toFixed(2);
        if (progressCallback) progressCallback(Number(progress));
      }
    });

    readStream.pipe(writeStream);

    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        const publicURL = `https://storage.googleapis.com/${bucketName}/${destination}?v=${dayjs().format()}`;
        resolve(publicURL);
      });

      writeStream.on('error', (err) => {
        reject(new Error(`Error uploading file: ${err.message}`));
      });
    });
  } catch (err) {
    throw new Error(`Error uploading file: ${err.message}`);
  }
};

export const uploadAgreementForm = async (
  tempFilePath: string,
  fileName: string,
  folderName: string,
): Promise<string> => {
  try {
    const bucketName = process.env.BUCKET_NAME as string;
    const destination = `${folderName}/${fileName}`;

    // Upload the file to the specified bucket
    const [file] = await storage.bucket(bucketName).upload(tempFilePath, {
      destination,
      gzip: true,
    });

    // Make the file public
    await file.makePublic();

    const publicURL = file.publicUrl(); // <- This is the correct way

    return publicURL;

    // Construct the public URL
    // const publicURL = `https://storage.googleapis.com/${bucketName}/${destination}?v=${dayjs().format()}`;
    return publicURL;
  } catch (err) {
    throw new Error(`Error uploading file: ${err.message}`);
  }
};

export const checkIfVideoExist = async (fileName: string, folderName: string) => {
  try {
    const bucketName = process.env.BUCKET_NAME as string;
    const destination = `${folderName}/${fileName}`;

    const bucket = storage.bucket(bucketName);

    const file = bucket.file(`https://storage.googleapis.com/${bucketName}/${destination}`);

    const [exist] = await file.exists();

    if (exist) {
      await file.delete();
      return true;
    }
    return false;
  } catch (error) {
    throw new Error('Error');
  }
};

export const uploadAgreementTemplate = async ({
  tempFilePath,
  fileName,
  folderName,
}: {
  tempFilePath: string;
  fileName: string;
  folderName: string;
}) => {
  try {
    const bucketName = process.env.BUCKET_NAME as string;
    const destination = `${folderName}/${fileName}`;

    const [file] = await storage.bucket(bucketName).upload(tempFilePath, {
      destination,
      gzip: true,
    });

    // Make the file public
    await file.makePublic();

    // Construct the public URL
    const publicURL = `https://storage.googleapis.com/${bucketName}/${destination}?v=${dayjs().format()}`;
    return publicURL;
  } catch (err) {
    throw new Error(`Error uploading file: ${err.message}`);
  }
};

export const uploadDigitalSignature = async ({
  tempFilePath,
  fileName,
  folderName,
}: {
  tempFilePath: string;
  fileName: string;
  folderName: string;
}) => {
  try {
    const bucketName = process.env.BUCKET_NAME as string;
    const destination = `${folderName}/${fileName}`;

    const [file] = await storage.bucket(bucketName).upload(tempFilePath, {
      destination,
      gzip: true,
    });

    // Make the file public
    await file.makePublic();

    // Construct the public URL
    const publicURL = `https://storage.googleapis.com/${bucketName}/${destination}?v=${dayjs().format()}`;
    return publicURL;
  } catch (err) {
    throw new Error(`Error uploading file: ${err.message}`);
  }
};

export const uploadAttachments = async ({
  tempFilePath,
  fileName,
  folderName,
}: {
  tempFilePath: string;
  fileName: string;
  folderName: string;
}) => {
  try {
    const bucketName = process.env.BUCKET_NAME as string;
    const destination = `${folderName}/${fileName}`;

    const [file] = await storage.bucket(bucketName).upload(tempFilePath, {
      destination,
      gzip: true,
    });

    // Make the file public
    await file.makePublic();

    // Construct the public URL
    const publicURL = `https://storage.googleapis.com/${bucketName}/${destination}?v=${dayjs().format()}`;
    return publicURL;
  } catch (err) {
    throw new Error(`Error uploading file: ${err.message}`);
  }
};

export const deleteContent = async ({ fileName, folderName }: any) => {
  const bucketName = process.env.BUCKET_NAME as string;
  const destination = `${folderName}/${fileName}`;
  try {
    const file = storage.bucket(bucketName).file(destination);

    // Delete the file
    await file.delete();

    console.log(`File ${fileName} deleted from bucket ${bucketName}.`);
  } catch (error) {
    throw new Error(error);
  }
};

const path = require('path');