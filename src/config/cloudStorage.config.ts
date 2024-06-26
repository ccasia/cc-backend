// import { Storage } from '@google-cloud/storage';

// const pathToJSONKey = `${__dirname}/test-cs.json`;

// const storage = new Storage({ keyFilename: pathToJSONKey });

// const bucketName = 'app-test-cult-cretive';

// export const uploadImage = async (fileName: string) => {
//   let publicURL;
//   storage.bucket(bucketName).upload(
//     `${fileName}`,
//     {
//       gzip: true,
//       metadata: {
//         cacheControl: 'public, max-age=31536000',
//       },
//     },
//     async (err, file) => {
//       if (err) {
//         return err;
//       }
//       file?.makePublic(async (err) => {
//         if (err) {
//           return err;
//         }
//         const publicURL = file.publicUrl();
//         return publicURL;
//       });
//     },
//   );

//   return publicURL;
// };

import { Storage } from '@google-cloud/storage';

const pathToJSONKey = `${__dirname}/test-cs.json`;

const storage = new Storage({ keyFilename: pathToJSONKey });

const bucketName = 'app-test-cult-cretive';

export const uploadImage = async (tempFilePath: string, fileName: string) => {
  const uploadPromise = new Promise<string>((resolve, reject) => {
    storage.bucket(bucketName).upload(
      tempFilePath,
      {
        destination: `campaigns/${fileName}`,
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
            const publicURL = `https://storage.googleapis.com/${bucketName}/campaigns/${fileName}`;
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
    storage.bucket(bucketName).upload(
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
            const publicURL = `https://storage.googleapis.com/${bucketName}/companyLogo/${fileName}`;
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
