import { snapshotLeaderboard } from '@/src/modules/gamification';

const periodId = process.argv[2];

if (!periodId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId)) {
  console.error('Usage: npx tsx src/scripts/snapshotLeaderboard.ts YYYY-MM');
  process.exit(1);
}

snapshotLeaderboard(periodId)
  .then((result) => {
    if (result.skipped) {
      console.warn(`Skipped ${periodId} — the period is still in progress.`);
      process.exit(1);
    }

    console.log(`Snapshotted ${periodId}: ranked ${result.ranked}, awarded ${result.awarded} placement bonuses.`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('[gamification] Snapshot failed:', error);
    process.exit(1);
  });
