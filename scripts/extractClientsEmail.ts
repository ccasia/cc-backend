import { PrismaClient } from '@prisma/client';
import { once } from 'events';
import fs from 'fs-extra';

const prisma = new PrismaClient();

async function exportClientsEmail() {
  const client = await prisma.company.findMany({
    select: {
      email: true,
      brand: {
        select: {
          email: true,
        },
      },
      pic: {
        select: {
          email: true,
        },
      },
    },
  });

  const seen = new Set<string>();
  const emails: { email: string }[] = [];
  const filePath = `${__dirname}/emails.csv`;
  const stream = fs.createWriteStream(filePath, { encoding: 'utf-8' });

  const write = async (line: string) => {
    if (!stream.write(line)) {
      await once(stream, 'drain'); // wait until the buffer clears
    }
  };

  const addEmail = async (email?: string | null) => {
    const normalized = email?.trim().toLowerCase();
    if (!normalized) return; // skips null, undefined, and ""
    if (seen.has(normalized)) return;
    seen.add(normalized);

    await write(`${normalized}\n`);
  };

  await write('email\n'); // CSV header

  for (const item of client) {
    await addEmail(item.email);
    for (const brand of item.brand ?? []) await addEmail(brand.email);
    for (const pic of item.pic ?? []) await addEmail(pic.email);
  }

  stream.end();
  await once(stream, 'finish');
}

exportClientsEmail()
  .then(() => {
    console.log(performance.now());
    console.log('Done ✨');
  })
  .catch((err) => {
    prisma.$disconnect();
  });
