import parsePhoneNumber, { CountryCode, isValidPhoneNumber } from 'libphonenumber-js';
import { prisma } from '../prisma/prisma';
import { PHONE_CODES } from '../constants/countryCodes';

function getCountryShortCode(country: string | null): CountryCode | undefined {
  if (!country) return;

  const shortCountryCode = PHONE_CODES.find((a) => a.country.toLowerCase().includes(country.toLowerCase()));

  return (shortCountryCode?.iso as unknown as CountryCode) ?? null;
}

const report: {
  phoneNumber: string;
  affectedUserIds: string[];
  affectedCount: number;
}[] = [];

const DRY_RUN = false;

async function main() {
  const uniqueUsers = await prisma.user.groupBy({
    by: ['phoneNumber'], // The column you want to count uniquely
    where: {
      phoneNumber: {
        not: null,
      },
    },
    _count: true, // Counts how many times each city appears
  });

  const duplicates = uniqueUsers.filter((a) => a._count > 1);

  for (const dup of duplicates) {
    const users = await prisma.user.findMany({
      where: { phoneNumber: dup.phoneNumber },
      select: { id: true },
    });

    if (!DRY_RUN) {
      await prisma.user.updateMany({
        where: { id: { in: users.map((u) => u.id) } },
        data: { phoneNumber: null, isPhoneVerified: false },
      });
    }

    report.push({
      phoneNumber: dup.phoneNumber,
      affectedUserIds: users.map((u) => u.id),
      affectedCount: users.length,
    });
  }

  console.log(DRY_RUN ? '--- DRY RUN, nothing written ---' : '--- APPLIED ---');
  console.table(report.map((r) => ({ ...r, affectedUserIds: r.affectedUserIds.join(', ') })));
  console.log(`\nTotal users who will need to re-verify: ${report.reduce((sum, r) => sum + r.affectedCount, 0)}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
