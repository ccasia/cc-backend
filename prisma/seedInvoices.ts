import { PrismaClient, InvoiceStatus } from '@prisma/client';
import dayjs from 'dayjs';

const prisma = new PrismaClient();

async function generateUniqueInvoiceNumber(): Promise<string> {
  while (true) {
    const randomNumber = Math.floor(1000 + Math.random() * 9000);
    const invoiceNumber = `INV-${randomNumber}`;
    const existing = await prisma.invoice.findUnique({ where: { invoiceNumber } });
    if (!existing) return invoiceNumber;
  }
}

async function main() {
  // Find creators that have shortlisted entries (meaning they're active in campaigns)
  const shortlisted = await prisma.shortListedCreator.findMany({
    where: {
      userId: { not: null },
    },
    include: {
      user: {
        include: {
          creator: true,
        },
      },
      campaign: true,
    },
    take: 5,
  });

  if (shortlisted.length === 0) {
    console.log('No shortlisted creators found. Cannot seed invoices.');
    return;
  }

  console.log(`Found ${shortlisted.length} shortlisted creators. Creating SGD draft invoices...`);

  const invoiceTo = {
    id: '1',
    name: 'Cult Creative',
    fullAddress: '5-3A, Block A, Jaya One, No.72A, Jalan Universiti, 46200 Petaling Jaya, Selangor',
    phoneNumber: '(+60)12-849 6499',
    company: 'Cult Creative',
    addressType: 'Hq',
    email: 'support@cultcreative.asia',
    primary: true,
  };

  const amounts = [500, 800, 1200, 1500, 2000];

  for (let i = 0; i < shortlisted.length; i++) {
    const entry = shortlisted[i];
    if (!entry.userId || !entry.user) continue;

    const amount = amounts[i % amounts.length];
    const invoiceNumber = await generateUniqueInvoiceNumber();
    const now = new Date();

    const invoiceFrom = {
      id: entry.userId,
      name: entry.user.name || 'Creator',
      phoneNumber: entry.user.phoneNumber || '',
      email: entry.user.email || '',
      fullAddress: entry.user.creator?.address || '',
      company: entry.user.creator?.employment || '',
      addressType: 'Home',
      primary: false,
    };

    const task = {
      title: 'Posting on social media',
      description: 'Posting on social media',
      service: 'Posting on social media',
      quantity: 1,
      price: amount,
      total: amount,
      currency: 'SGD',
      currencySymbol: 'S$',
    };

    const bankAcc = {
      bankName: 'DBS Bank',
      accountName: entry.user.name || 'Creator',
      payTo: entry.user.name || 'Creator',
      accountNumber: `SGD-${Math.floor(100000000 + Math.random() * 900000000)}`,
      accountEmail: entry.user.email || '',
      currency: 'SGD',
    };

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        amount,
        status: 'draft' as InvoiceStatus,
        task,
        bankAcc,
        invoiceFrom,
        invoiceTo,
        dueDate: dayjs(now).add(28, 'day').toDate(),
        creatorId: entry.userId,
        campaignId: entry.campaignId,
      },
    });

    // Also update the ShortListedCreator currency to SGD
    await prisma.shortListedCreator.update({
      where: { id: entry.id },
      data: { currency: 'SGD' },
    });

    console.log(
      `Created invoice ${invoice.invoiceNumber} | SGD ${amount} | Creator: ${entry.user.name} | Campaign: ${entry.campaign.name}`,
    );
  }

  console.log('\nDone! Seeded SGD draft invoices.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
