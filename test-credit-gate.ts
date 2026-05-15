import { PrismaClient } from '@prisma/client';
import { getRemainingCredits } from './src/service/companyService';

const prisma = new PrismaClient();

async function main() {
  const companyId = process.argv[2];
  if (!companyId) {
    console.error('Usage: npx ts-node test-credit-gate.ts <companyId>');
    process.exit(1);
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      subscriptions: {
        where: { status: 'ACTIVE' },
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
              status: true,
              campaignCredits: true,
              creditsUtilized: true,
              creditsPending: true,
            },
          },
        },
      },
    },
  });

  if (!company) {
    console.error(`Company ${companyId} not found`);
    process.exit(1);
  }

  console.log(`\n=== Company: ${company.name} (${company.id}) ===\n`);

  if (company.subscriptions.length === 0) {
    console.log('No ACTIVE subscriptions. Test cannot run on this company.\n');
    await prisma.$disconnect();
    return;
  }

  let totalRealAvailable = 0;

  for (const sub of company.subscriptions) {
    const totalCredits = sub.totalCredits ?? 0;
    const creditsUsed = sub.creditsUsed ?? 0;
    const realAvailable = totalCredits - creditsUsed;
    const sumUtilized = sub.campaign.reduce((s, c) => s + (c.creditsUtilized || 0), 0);
    const gateAvailable = totalCredits - sumUtilized;

    totalRealAvailable += Math.max(0, realAvailable);

    console.log(`Subscription ${sub.id}`);
    console.log(`  status:                          ${sub.status}`);
    console.log(`  expiredAt:                       ${sub.expiredAt.toISOString()}`);
    console.log(`  totalCredits:                    ${totalCredits}`);
    console.log(`  creditsUsed (allocation):        ${creditsUsed}`);
    console.log(`  Σ creditsUtilized (consumption): ${sumUtilized}`);
    console.log(`  REAL available (total - used):   ${realAvailable}`);
    console.log(`  GATE available (total - utilz):  ${gateAvailable}`);

    if (gateAvailable > realAvailable) {
      const phantom = gateAvailable - realAvailable;
      console.log(`  ⚠️  Gate over-reports by ${phantom} credit(s) — the bug surface for this sub.`);
    } else if (gateAvailable < realAvailable) {
      console.log(`  ℹ️  Gate under-reports by ${realAvailable - gateAvailable}. (Unusual; investigate.)`);
    } else {
      console.log(`  ✅ Gate and reality agree for this sub.`);
    }

    if (sub.campaign.length > 0) {
      console.log(`  Campaigns linked:`);
      for (const c of sub.campaign) {
        console.log(
          `    - ${c.name} [${c.status}]  credits=${c.campaignCredits}  utilized=${c.creditsUtilized}  pending=${c.creditsPending}`,
        );
      }
    }
    console.log('');
  }

  const remaining = await getRemainingCredits(company.id);
  console.log(`getRemainingCredits(${company.id}) → ${remaining}`);
  console.log(`Sum of REAL available across active subs: ${totalRealAvailable}\n`);

  console.log('--- Interpretation ---');
  if (remaining !== null && remaining > totalRealAvailable) {
    console.log(`⚠️  BUG CONFIRMED.`);
    console.log(
      `   Gate returned ${remaining} but only ${totalRealAvailable} is actually allocatable.`,
    );
    console.log(
      `   A new campaign with campaignCredits ≤ ${remaining} would pass the gate.`,
    );
    console.log(
      `   Those above ${totalRealAvailable} would create a campaign with empty creditAllocationBreakdown`,
    );
    console.log(`   and no subscription.creditsUsed increment — silent over-allocation.`);
  } else if (remaining === totalRealAvailable) {
    console.log(`✅ Gate matches reality for this company. No over-allocation surface right now.`);
    console.log(`   (Bug only manifests when some campaign has campaignCredits > creditsUtilized,`);
    console.log(`   i.e., allocated-but-not-fully-consumed credits exist.)`);
  } else {
    console.log(`ℹ️  Gate returned LESS than real available. Investigate — unusual case.`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
