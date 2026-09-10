/* eslint-disable promise/always-return */
/* eslint-disable promise/catch-or-return */
import { PrismaClient } from '@prisma/client';
import { JWT } from 'google-auth-library';
// import { getCountryShortCode, normalizePhone } from '../helper/normalizedPhoneNumber';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { getCountryShortCode, normalizePhone } from '../service/phone_number';

const prisma = new PrismaClient();

interface ContactRow {
  Company: string;
  Brand: string;
  Industries: string;
  'Contact Type': string;
  Name: string;
  Email: string;
  Designation: string;
  'Phone Number': string;
}

function formatIndustries(industries: unknown): string {
  if (!industries) return '';
  if (Array.isArray(industries)) return industries.join(', ');
  if (typeof industries === 'string') return industries;
  return JSON.stringify(industries);
}

function formatPhone(rawPhone: string | null | undefined, country?: string | null): string {
  if (!rawPhone) return '';
  const phone = normalizePhone(rawPhone, getCountryShortCode(country ?? ''));
  return phone.status === 'valid' ? phone.e164 : phone.original;
}

async function main() {
  const companies = await prisma.company.findMany({
    where: {
      OR: [{ clients: { some: {} } }, { brand: { some: {} } }, { pic: { some: {} } }],
    },
    select: {
      name: true,
      pic: {
        select: {
          name: true,
          email: true,
          designation: true,
        },
      },
      clients: {
        select: {
          user: {
            select: {
              name: true,
              email: true,
              phoneNumber: true,
              country: true,
            },
          },
        },
      },
      brand: {
        select: {
          name: true,
          email: true,
          phone: true,
          industries: true,
          pic: {
            select: {
              name: true,
              email: true,
              designation: true,
            },
          },
        },
      },
    },
  });

  const rows: ContactRow[] = [];

  for (const company of companies) {
    for (const pic of company.pic) {
      rows.push({
        Company: company.name,
        Brand: '',
        Industries: '',
        'Contact Type': 'PIC',
        Name: pic.name ?? '',
        Email: pic.email ?? '',
        Designation: pic.designation ?? '',
        'Phone Number': '',
      });
    }

    for (const client of company.clients) {
      rows.push({
        Company: company.name,
        Brand: '',
        Industries: '',
        'Contact Type': 'Client',
        Name: client.user.name ?? '',
        Email: client.user.email ?? '',
        Designation: '',
        'Phone Number': formatPhone(client.user.phoneNumber, client.user.country),
      });
    }

    for (const brand of company.brand) {
      const industries = formatIndustries(brand.industries);

      rows.push({
        Company: company.name,
        Brand: brand.name,
        Industries: industries,
        'Contact Type': 'Brand',
        Name: brand.name ?? '',
        Email: brand.email ?? '',
        Designation: '',
        'Phone Number': formatPhone(brand.phone),
      });

      for (const pic of brand.pic) {
        rows.push({
          Company: company.name,
          Brand: brand.name,
          Industries: industries,
          'Contact Type': 'PIC',
          Name: pic.name ?? '',
          Email: pic.email ?? '',
          Designation: pic.designation ?? '',
          'Phone Number': '',
        });
      }
    }
  }

  //   const { GoogleSpreadsheet } = await import('google-spreadsheet');
  const serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
  });

  const doc = await GoogleSpreadsheet.createNewSpreadsheetDocument(serviceAccountAuth, {
    title: `Clients Export - ${new Date().toISOString().slice(0, 10)}`,
  });

  const sheet = doc.sheetsByIndex[0];
  await sheet.setHeaderRow([
    'Company',
    'Brand',
    'Industries',
    'Contact Type',
    'Name',
    'Email',
    'Designation',
    'Phone Number',
  ]);

  if (rows.length) {
    await sheet.addRows(rows as unknown as Record<string, string>[]);
  }

  await doc.share('afiq@cultcreative.asia');

  const url = `https://docs.google.com/spreadsheets/d/${doc.spreadsheetId}/`;

  console.log(`Exported ${rows.length} contacts from ${companies.length} companies`);
  console.log(url);
}

main()
  .then(() => {
    console.log("Done export client's data");
  })
  .catch((err) => {
    console.log("Error export client's data: ", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
