import { prisma } from './prisma/prisma';

(async () => {
  const data = await prisma.user.findMany({
    select: {
      phoneNumber: true,
      country: true,
    },
    take: 50,
  });

  const asd = data.map((item) => {
    const sanitize = item.phoneNumber?.replace(/\D+/g, '').replace(/^(60|0)+/, '');
    return { ...item, phone: `60 ${sanitize}` };
  });

  console.log(asd);
})();
