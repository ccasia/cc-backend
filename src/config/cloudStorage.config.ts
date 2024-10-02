import { Storage, TransferManager } from '@google-cloud/storage';
import dayjs from 'dayjs';
import fs from 'fs';

const pathToJSONKey = `${__dirname}/test-cs.json`;

const storage = new Storage({
  keyFilename: pathToJSONKey,
});

export const uploadImage = async (tempFilePath: string, fileName: string, folderName: string) => {
  //console.log(tempFilePath, fileName, folderName);
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
            const publicURL = `https://storage.googleapis.com/${process.env.BUCKET_NAME}/${folderName}/${fileName}`;
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

export const uploadProfileImage = async (tempFilePath: string, fileName: string, folderName: string) => {
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
            const publicURL = `https://storage.googleapis.com/${process.env.BUCKET_NAME}/${folderName}/${fileName}`;
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
  progressCallback?: any,
  size?: number,
  abortSignal?: AbortSignal,
) => {
  try {
    const bucketName = process.env.BUCKET_NAME as string;
    const destination = `${folderName}/${fileName}`;

    await checkIfVideoExist(fileName, folderName);

    // Upload the file to the specified bucket
    const [file] = await storage.bucket(bucketName).upload(tempFilePath, {
      destination,
      gzip: true,
      resumable: true,
      metadata: {
        contentType: 'video/mp4',
      },
      onUploadProgress: (event) => {
        if (size) {
          const progress = (event.bytesWritten / size) * 100;
          progressCallback(progress);
        }
      },
    });

    abortSignal?.addEventListener('abort', () => {
      //console.log('ABORTING UPLOAD GCP');
    });

    const publicURL = `https://storage.googleapis.com/${bucketName}/${destination}?v=${dayjs().format()}`;
    return publicURL;
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

    // Construct the public URL
    const publicURL = `https://storage.googleapis.com/${bucketName}/${destination}?v=${dayjs().format()}`;
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
