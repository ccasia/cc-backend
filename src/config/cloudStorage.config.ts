import { Storage } from '@google-cloud/storage';

const pathToJSONKey = `${__dirname}/test-cs.json`;

const storage = new Storage({ keyFilename: pathToJSONKey });

const bucketName = 'app-test-cult-cretive';

export const uploadImage = async (fileName: string) => {
  storage.bucket(bucketName).upload(
    `campaigns/${fileName}`,
    {
      gzip: true,
      metadata: {
        cacheControl: 'public, max-age=31536000',
      },
    },
    async (err, file) => {
      if (err) {
        return err;
      }
      file?.makePublic(async (err) => {
        if (err) {
          return err;
        }
        const publicURL = file.publicUrl();
        console.log(publicURL);
        return publicURL;
      });
    },
  );
};
