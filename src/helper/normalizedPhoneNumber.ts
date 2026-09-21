import { prisma } from '../prisma/prisma';
import { getCountryShortCode, normalizePhone } from '../service/phone_number';

async function main() {
  const users = await prisma.user.findMany({
    where: { phoneNumber: { not: null } },
    select: { id: true, phoneNumber: true, country: true },
  });

  const results = { fixed: 0, alreadyValid: 0, flagged: 0, unmappedCountry: 0 };
  const flaggedUsers: { id: string; original: string; country: string | null; reason: string }[] = [];

  for (const user of users) {
    const regionHint = getCountryShortCode(user.country);
    if (user.country && !regionHint) results.unmappedCountry++; // track country names you haven't mapped yet

    const result = normalizePhone(user.phoneNumber!, regionHint);

    if (result.status === 'valid') {
      if (result.e164 !== user.phoneNumber) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            phoneNumber: result.e164,
          },
        });
        results.fixed++;
      } else {
        results.alreadyValid++;
      }
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: { phoneNumber: null },
      });
      results.flagged++;
      flaggedUsers.push({ id: user.id, original: result.original, country: user.country, reason: result.reason });
    }
  }

  console.log('Migration summary:', results);
  console.table(flaggedUsers);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
