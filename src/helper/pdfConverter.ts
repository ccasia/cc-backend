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
        console.log(`PDF saved to: ${outputPath}`);
        resolve(outputPath);
      }
    });
  });
};

// const content = fs.readFileSync('agreement.docx', 'binary');

// const zip = new PizZip(content);

// const doc = new Docxtemplater(zip);

// doc.setData({
//   DATE: dayjs().format('LL'),
//   FREELANCER_FULL_NAME: 'Afiq danial bin Noorazam',
//   IC_NUMBER: '000829-05-0027',
//   ADDRESS: '27adokjansmdliajnusdiluajsnidaunsdmoaisdm',
//   CC_EMAIL: 'ccc@gmail.com',
//   CC_PHONE_NUMBER: '8810123123',
//   AGREEMENT_ENDDATE: dayjs().format('LL'),
//   NOW_DATE: dayjs().format('LL'),
// });

// try {
//   doc.render();
// } catch (error) {
//   console.error(error);
// }

// const buf = doc.getZip().generate({ type: 'nodebuffer' });

// fs.writeFileSync('output.docx', buf);
