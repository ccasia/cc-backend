import fs from 'fs';
import libre from 'libreoffice-convert';

export const pdfConverter = async (inputPath: string, outputPath: string) => {
  const extend = '.pdf';

  return new Promise<string>((resolve, reject) => {
    const file = fs.readFileSync(inputPath);

    libre.convert(file, extend, undefined, (err, done) => {
      if (err) {
        console.error(`Error converting file: ${err}`);
        reject(err);
      } else {
        fs.unlinkSync(inputPath);
        fs.writeFileSync(outputPath, done);
        resolve(outputPath);
      }
    });
  });
};
