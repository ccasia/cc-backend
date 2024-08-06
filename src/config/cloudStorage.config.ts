import { Storage, TransferManager } from '@google-cloud/storage';
import fs from 'fs';

const pathToJSONKey = `${__dirname}/test-cs.json`;

const storage = new Storage({
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
  size: number,
  progressCallback: any,
  abortSignal: AbortSignal,
) => {
  try {
    const bucketName = process.env.BUCKET_NAME as string;
    const destination = `${folderName}/${fileName}`;

    // const bucket = storage.bucket(bucketName);
    // const file = bucket.file(destination);

    // const readStream = fs.createReadStream(tempFilePath, { highWaterMark: 20 * 1024 * 1024 });
    // const writeStream = file.createWriteStream({
    //   resumable: true,
    //   metadata: {
    //     contentType: 'video/mp4',
    //   },
    // });

    // return new Promise((resolve, reject) => {
    //   writeStream.on('finish', () => {
    //     const publicURL = `https://storage.googleapis.com/${bucketName}/${destination}`;
    //     resolve(publicURL); // Resolve the promise with the public URL
    //   });

    //   writeStream.on('error', (err) => {
    //     reject(err); // Reject the promise if there's an error
    //   });

    //   readStream.on('error', (err) => {
    //     reject(err); // Reject the promise if there's an error with the read stream
    //   });

    //   readStream.pipe(writeStream);
    // });

    // Upload the file to the specified bucket
    const [file] = await storage.bucket(bucketName).upload(tempFilePath, {
      destination,
      gzip: true,
      resumable: true,
      metadata: {
        contentType: 'video/mp4',
      },
      onUploadProgress: (event) => {
        const progress = (event.bytesWritten / size) * 100;
        progressCallback(progress);
      },
    });

    abortSignal.addEventListener('abort', () => {
      console.log('ABORTING UPLOAD GCP');
    });

    // Make the file public
    // await file.makePublic();

    const publicURL = `https://storage.googleapis.com/${bucketName}/${destination}`;
    return publicURL;

    // Construct the public URL
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
    const publicURL = `https://storage.googleapis.com/${bucketName}/${destination}`;
    return publicURL;
  } catch (err) {
    throw new Error(`Error uploading file: ${err.message}`);
  }
};
