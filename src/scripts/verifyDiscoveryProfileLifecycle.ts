import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../prisma/prisma';
import { createDiscoveryMetricAudit } from '../service/creatorDiscoveryProfileService';
import { applyExtractionToPendingPitches } from '../service/guestProfileExtraction/pendingPitchMetrics';

// Real database checks, rolled back as a unit. No provider or queue calls.
async function main() {
  const rollback = new Error('verification rollback');
  try {
    await prisma.$transaction(
      async (tx) => {
        const campaign = await tx.campaign.findFirst({ select: { id: true } });
        assert.ok(campaign, 'A local campaign is required');
        const user = await tx.user.create({
          data: {
            email: `discovery-check-${randomUUID()}@example.invalid`,
            role: 'creator',
            name: 'Discovery test',
            creator: { create: { isGuest: true } },
          },
        });
        const pitch = await tx.pitch.create({
          data: { userId: user.id, campaignId: campaign.id, type: 'shortlisted', status: 'PENDING_REVIEW' },
        });
        const extractionData = {
          campaignId: campaign.id,
          requestedByUserId: 'test',
          canonicalProfileKey: 'tiktok:discoverycheck',
          canonicalProfileUrl: 'https://www.tiktok.com/@discoverycheck',
          platform: 'tiktok' as const,
          actorId: 'test',
          actorBuild: '1',
          requestFingerprint: 'test',
          resultFollowerCount: 0,
          resultEngagementRate: '7.55',
          selectedPosts: [
            { postId: 'one', caption: '#saved', likes: 0, comments: 2, views: 20, saves: null, shares: null },
          ],
          candidatePosts: [{ postId: 'two', usedInSample: false, rejectedReason: 'PINNED' }],
          formulaVersion: 'tiktok_recent_10_median_view_v2',
          completedAt: new Date('2026-09-01'),
        };
        const extraction = await tx.guestProfileExtraction.create({
          data: { ...extractionData, status: 'READY', idempotencyKey: randomUUID() },
        });
        assert.equal(
          await tx.creatorDiscoveryProfile.count({ where: { userId: user.id } }),
          0,
          'Unused preview stays out',
        );
        const base = {
          pitchId: pitch.id,
          guestUserId: user.id,
          platform: 'tiktok',
          canonicalProfileKey: 'tiktok:discoverycheck',
          performedByUserId: 'test',
        };
        await createDiscoveryMetricAudit(tx, {
          data: {
            ...base,
            extractionId: extraction.id,
            source: 'automatic',
            finalFollowerCount: 0,
            finalEngagementRate: '7.55',
            createdAt: new Date('2026-09-01'),
          },
        });
        const read = () =>
          tx.creatorDiscoveryProfile.findUniqueOrThrow({
            where: { userId_platform: { userId: user.id, platform: 'tiktok' } },
          });
        assert.equal((await read()).followers, 0);
        assert.equal((await read()).engagementRate, 7.55);
        await createDiscoveryMetricAudit(tx, {
          data: { ...base, source: 'manual_override', finalEngagementRate: '12', createdAt: new Date('2026-09-02') },
        });
        const overridden = await read();
        assert.equal(overridden.engagementRate, 12);
        assert.equal((overridden.scrapeDetails as any).engagementRate, 7.55);
        await createDiscoveryMetricAudit(tx, {
          data: { ...base, source: 'automatic', finalEngagementRate: '1', createdAt: new Date('2026-08-01') },
        });
        assert.equal((await read()).engagementRate, 12, 'Older backfill cannot overwrite newer save');
        await createDiscoveryMetricAudit(tx, {
          data: { ...base, source: 'unavailable', createdAt: new Date('2026-09-03') },
        });
        assert.deepEqual(await read(), overridden, 'Failed scrape must not erase values or evidence');
        await tx.guestProfileExtraction.delete({ where: { id: extraction.id } });
        assert.deepEqual((await read()).scrapeDetails, overridden.scrapeDetails, 'Evidence survives temporary cleanup');
        const pending = await tx.guestProfileExtraction.create({
          data: { ...extractionData, status: 'READY', resultEngagementRate: '24.39', idempotencyKey: randomUUID() },
        });
        await tx.pitch.update({
          where: { id: pitch.id },
          data: { pendingExtractionId: pending.id, followerCount: null, engagementRate: null },
        });
        const store = { ...tx, $transaction: async (callback: any) => callback(tx) } as any;
        assert.equal(await applyExtractionToPendingPitches(pending.id, store), true);
        assert.equal((await read()).engagementRate, 24.39);
        const completed = await read();
        assert.equal(await applyExtractionToPendingPitches(pending.id, store), false);
        assert.deepEqual(await read(), completed, 'Repeated completion changes nothing');
        const failed = await tx.guestProfileExtraction.create({
          data: { ...extractionData, status: 'FAILED', idempotencyKey: randomUUID() },
        });
        await tx.pitch.update({ where: { id: pitch.id }, data: { pendingExtractionId: failed.id } });
        await applyExtractionToPendingPitches(failed.id, store);
        assert.deepEqual(await read(), completed, 'Failed pending run preserves saved values');
        console.log(
          'PASS: unused preview, immediate save, zero, manual override, old backfill, failure, cleanup, pending completion, repeat completion.',
        );
        throw rollback;
      },
      { timeout: 30000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
  console.log('Verification records rolled back.');
}
main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
