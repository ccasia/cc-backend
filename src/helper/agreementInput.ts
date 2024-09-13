import fs from 'fs';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat.js';
import path from 'path';

dayjs.extend(localizedFormat);

export const agreementInput = (data: {
  date: string;
  creatorName: string;
  icNumber: string;
  address: string;
  agreement_endDate: string;
  now_date: string;
  creatorAccNumber: string;
  creatorBankName: string;
  paymentAmount?: number;
}) => {
  const {
    date,
    creatorName,
    icNumber,
    address,
    agreement_endDate,
    now_date,
    creatorAccNumber,
    creatorBankName,
    paymentAmount,
  } = data;

  try {
    const paths = path.resolve(__dirname, '../form/agreement_template.docx');
    const content = fs.readFileSync(paths, 'binary');

    const zip = new PizZip(content);

    const doc = new Docxtemplater(zip);

    doc.setData({
      DATE: date,
      FREELANCER_FULL_NAME: creatorName,
      IC_NUMBER: icNumber,
      ADDRESS: address,
      CC_EMAIL: 'ccc@gmail.com',
      CC_PHONE_NUMBER: '123123123',
      AGREEMENT_ENDDATE: agreement_endDate,
      NOW_DATE: now_date,
      CREATOR_NAME: creatorName,
      CREATOR_ACCOUNT_NUMBER: creatorAccNumber,
      CREATOR_BANK_NAME: creatorBankName,
      CREATOR_PAYMENT: paymentAmount ? paymentAmount.toString() : '200',
    });

    try {
      doc.render();
    } catch (error) {
      console.error(error);
    }

    const buf = doc.getZip().generate({ type: 'nodebuffer' });

    const outputPath = path.resolve(__dirname, `../form/tmp/${creatorName.split(' ').join('_')}.docx`);

    fs.writeFileSync(outputPath, buf);

    return outputPath;
  } catch (error) {
    console.log(error);
    console.log('File path not found');
    return error;
  }
};
