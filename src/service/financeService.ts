import { InvoiceStatus, Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DAY_MS = 24 * 60 * 60 * 1000;

const pct = (used: number, total: number): number | null => (total > 0 ? Math.round((used / total) * 100) : null);

export const getFinanceDashboardData = async (startDate: Date, endDate: Date) => {
  const now = new Date();
  const createdInRange = { gte: startDate, lte: endDate };

  const [draftInvoices, processingInvoices, overdue, newClientLinks, subscriptions] = await Promise.all([
    prisma.invoice.count({
      where: { status: 'draft', createdAt: createdInRange },
    }),
    prisma.invoice.findMany({
      where: { status: 'processing', createdAt: createdInRange },
      select: { createdAt: true },
    }),
    // Stored `overdue` status plus unpaid invoices past dueDate that were never flipped.
    // Drafts are excluded here — they're already counted in the draft card.
    prisma.invoice.count({
      where: {
        createdAt: createdInRange,
        OR: [
          { status: 'overdue' },
          {
            dueDate: { lt: now },
            status: { notIn: ['paid', 'approved', 'rejected', 'draft', 'pending_approval', 'overdue'] },
          },
        ],
      },
    }),
    prisma.subscription.findMany({
      where: {
        createdAt: createdInRange,
        companyId: { not: null },
        status: { not: 'CANCELLED' },
      },
      select: { companyId: true },
    }),
    // EXPIRED subs stay in the utilisation list so finance can chase renewals;
    // only CANCELLED are dropped entirely.
    prisma.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'EXPIRED'] }, companyId: { not: null } },
      include: {
        company: { select: { id: true, name: true, logo: true } },
        package: { select: { name: true } },
        customPackage: { select: { customName: true } },
      },
    }),
  ]);

  const newClients = new Set(newClientLinks.map((subscription) => subscription.companyId)).size;

  // No status-transition timestamp exists on Invoice, so aging is bucketed by
  // createdAt — it can only overstate age, never hide a stuck invoice.
  const aging = { under3d: 0, from3to7d: 0, over7d: 0 };
  processingInvoices.forEach(({ createdAt }) => {
    const days = (now.getTime() - createdAt.getTime()) / DAY_MS;
    if (days < 3) aging.under3d += 1;
    else if (days <= 7) aging.from3to7d += 1;
    else aging.over7d += 1;
  });

  const packageLabelOf = (sub: (typeof subscriptions)[number]) =>
    sub.package?.name ?? sub.customPackage?.customName ?? 'Custom';

  const activeSnapshot = subscriptions.filter((sub) => sub.status === 'ACTIVE' && sub.expiredAt > now);

  const revenueByCurrency = new Map<string, number>();
  activeSnapshot.forEach((sub) => {
    const currency = sub.currency || 'MYR';
    revenueByCurrency.set(currency, (revenueByCurrency.get(currency) || 0) + (sub.packagePrice || 0));
  });

  const activePackagesList = activeSnapshot.map((sub) => ({
    subscriptionId: sub.id,
    companyId: sub.companyId,
    companyName: sub.company?.name ?? 'Unknown',
    logo: sub.company?.logo ?? null,
    packageLabel: packageLabelOf(sub),
    currency: sub.currency || 'MYR',
    expiredAt: sub.expiredAt,
    packagePrice: sub.packagePrice || 0,
    creditsUsed: sub.creditsUsed || 0,
    totalCredits: sub.totalCredits || 0,
  }));

  // Creator budget: cap = package prices, used = invoiced amounts across the
  // company's campaigns (rejected invoices excluded).
  const companyIds = [...new Set(subscriptions.map((sub) => sub.companyId as string))];
  const campaigns = await prisma.campaign.findMany({
    where: { companyId: { in: companyIds } },
    select: { id: true, companyId: true },
  });
  const invoiceSums = campaigns.length
    ? await prisma.invoice.groupBy({
        by: ['campaignId'],
        _sum: { amount: true },
        where: { campaignId: { in: campaigns.map((c) => c.id) }, status: { not: 'rejected' } },
      })
    : [];

  const campaignToCompany = new Map(campaigns.map((c) => [c.id, c.companyId as string]));
  const budgetUsedByCompany = new Map<string, number>();
  invoiceSums.forEach((sum) => {
    const companyId = campaignToCompany.get(sum.campaignId);
    if (!companyId) return;
    budgetUsedByCompany.set(companyId, (budgetUsedByCompany.get(companyId) || 0) + (sum._sum.amount || 0));
  });

  const subsByCompany = new Map<string, typeof subscriptions>();
  subscriptions.forEach((sub) => {
    const companyId = sub.companyId as string;
    const list = subsByCompany.get(companyId) || [];
    list.push(sub);
    subsByCompany.set(companyId, list);
  });

  const clients = [...subsByCompany.entries()].map(([companyId, subs]) => {
    const sorted = [...subs].sort((a, b) => a.expiredAt.getTime() - b.expiredAt.getTime());
    const earliest = sorted[0];

    const ugcUsed = subs.reduce((acc, sub) => acc + (sub.creditsUsed || 0), 0);
    const ugcTotal = subs.reduce((acc, sub) => acc + (sub.totalCredits || 0), 0);
    const budgetCap = subs.reduce((acc, sub) => acc + (sub.packagePrice || 0), 0);
    const budgetUsed = budgetUsedByCompany.get(companyId) || 0;

    const baseLabel = packageLabelOf(earliest);

    return {
      companyId,
      companyName: earliest.company?.name ?? 'Unknown',
      logo: earliest.company?.logo ?? null,
      packageLabel: subs.length > 1 ? `${baseLabel} +${subs.length - 1} more` : baseLabel,
      currency: earliest.currency || 'MYR',
      expiresAt: earliest.expiredAt,
      subscriptionCount: subs.length,
      ugc: { used: ugcUsed, total: ugcTotal, pct: pct(ugcUsed, ugcTotal) },
      budget: { used: budgetUsed, cap: budgetCap, pct: pct(budgetUsed, budgetCap) },
    };
  });

  clients.sort((a, b) => Math.max(b.ugc.pct ?? -1, b.budget.pct ?? -1) - Math.max(a.ugc.pct ?? -1, a.budget.pct ?? -1));

  return {
    range: { startDate, endDate },
    stats: {
      draftInvoices,
      processing: { total: processingInvoices.length, aging },
      overdue,
      newClients,
      activePackages: activeSnapshot.length,
      packageRevenue: [...revenueByCurrency.entries()].map(([currency, amount]) => ({
        currency,
        amount,
      })),
    },
    activePackagesList,
    clients,
  };
};

export type FinanceInvoiceStatus = 'draft' | 'processing' | 'overdue';

export const getNewPackageClients = async (startDate: Date, endDate: Date) => {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
      companyId: { not: null },
      status: { not: 'CANCELLED' },
    },
    select: {
      id: true,
      companyId: true,
      currency: true,
      packagePrice: true,
      totalCredits: true,
      status: true,
      createdAt: true,
      expiredAt: true,
      company: { select: { name: true, logo: true } },
      package: { select: { name: true } },
      customPackage: { select: { customName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const clients = new Map<
    string,
    {
      companyId: string;
      companyName: string;
      logo: string | null;
      linkedAt: Date;
      packages: {
        subscriptionId: string;
        name: string;
        currency: string;
        price: number;
        credits: number;
        status: string;
        expiredAt: Date;
      }[];
    }
  >();

  subscriptions.forEach((subscription) => {
    const companyId = subscription.companyId as string;
    const existing = clients.get(companyId);
    const linkedPackage = {
      subscriptionId: subscription.id,
      name: subscription.package?.name ?? subscription.customPackage?.customName ?? 'Custom package',
      currency: subscription.currency || 'MYR',
      price: subscription.packagePrice || 0,
      credits: subscription.totalCredits || 0,
      status: subscription.status,
      expiredAt: subscription.expiredAt,
    };

    if (existing) {
      existing.packages.push(linkedPackage);
      return;
    }

    clients.set(companyId, {
      companyId,
      companyName: subscription.company?.name ?? 'Unknown client',
      logo: subscription.company?.logo ?? null,
      linkedAt: subscription.createdAt,
      packages: [linkedPackage],
    });
  });

  return [...clients.values()];
};

export const getFinanceInvoices = async (status: FinanceInvoiceStatus, startDate: Date, endDate: Date) => {
  const statusFilter: Prisma.InvoiceWhereInput =
    status === 'overdue'
      ? {
          OR: [
            { status: InvoiceStatus.overdue },
            {
              dueDate: { lt: new Date() },
              status: {
                notIn: [
                  InvoiceStatus.paid,
                  InvoiceStatus.approved,
                  InvoiceStatus.rejected,
                  InvoiceStatus.draft,
                  InvoiceStatus.pending_approval,
                  InvoiceStatus.overdue,
                ],
              },
            },
          ],
        }
      : { status };

  const invoices = await prisma.invoice.findMany({
    where: {
      ...statusFilter,
      createdAt: { gte: startDate, lte: endDate },
    },
    select: {
      id: true,
      invoiceNumber: true,
      amount: true,
      status: true,
      createdAt: true,
      dueDate: true,
      task: true,
      creatorId: true,
      user: {
        select: { name: true, role: true },
      },
      campaign: {
        select: {
          name: true,
          creatorAgreement: {
            select: { userId: true, currency: true },
          },
          campaignAdmin: {
            select: {
              role: true,
              admin: {
                select: {
                  user: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return invoices.map((invoice) => {
    const task = invoice.task as {
      currency?: string;
      items?: { currency?: string }[];
    } | null;
    const agreement = invoice.campaign.creatorAgreement.find((item) => item.userId === invoice.creatorId);
    const campaignAdmin =
      invoice.campaign.campaignAdmin.find((item) => item.role === 'manager') ||
      invoice.campaign.campaignAdmin.find((item) => item.role === 'owner') ||
      invoice.campaign.campaignAdmin.find((item) => item.role === 'editor') ||
      invoice.campaign.campaignAdmin[0];
    const issuingAdminName =
      invoice.user?.role === 'admin' || invoice.user?.role === 'superadmin' || invoice.user?.role === 'finance'
        ? invoice.user.name
        : null;

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      status: invoice.status,
      createdAt: invoice.createdAt,
      dueDate: invoice.dueDate,
      campaignName: invoice.campaign.name,
      adminName: issuingAdminName || campaignAdmin?.admin.user.name || 'Unassigned admin',
      currency: task?.currency || task?.items?.[0]?.currency || agreement?.currency || 'MYR',
    };
  });
};

export const getClientCampaignBreakdown = async (companyId: string) => {
  const campaigns = await prisma.campaign.findMany({
    where: { companyId },
    select: { id: true, name: true, status: true, creditsUtilized: true, campaignCredits: true },
    orderBy: { createdAt: 'desc' },
  });

  const invoiceSums = campaigns.length
    ? await prisma.invoice.groupBy({
        by: ['campaignId'],
        _sum: { amount: true },
        where: { campaignId: { in: campaigns.map((c) => c.id) }, status: { not: 'rejected' } },
      })
    : [];

  const invoicedByCampaign = new Map(invoiceSums.map((sum) => [sum.campaignId, sum._sum.amount || 0]));

  return campaigns.map((campaign) => ({
    campaignId: campaign.id,
    name: campaign.name,
    status: campaign.status,
    creditsUtilized: campaign.creditsUtilized || 0,
    campaignCredits: campaign.campaignCredits || 0,
    invoicedAmount: invoicedByCampaign.get(campaign.id) || 0,
  }));
};
