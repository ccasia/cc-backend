import { awardXp, getXpHistory, getCreatorPoints } from '@modules/gamification/gamification.service';

const USER_ID = 'cm3inmly3003c69ic1twasyvf';

const main = async () => {
  console.log(await awardXp({ userId: USER_ID, actionCode: 'pitch_submitted', sourceId: 'test-pitch-1' }));
  console.log(await awardXp({ userId: USER_ID, actionCode: 'pitch_submitted', sourceId: 'test-pitch-1' }));
  console.log(await awardXp({ userId: USER_ID, actionCode: 'pitch_submitted', sourceId: 'test-pitch-2' }));
  console.log(await awardXp({ userId: USER_ID, actionCode: 'connecting_media_kit' }));
  console.log(await awardXp({ userId: USER_ID, actionCode: 'connecting_media_kit' }));
  console.log(await awardXp({ userId: USER_ID, actionCode: 'nope' }));
  console.log(await awardXp({ userId: USER_ID, actionCode: 'achievement', sourceId: 'test-big', xp: 1000 }));
  console.log(await awardXp({ userId: USER_ID, actionCode: 'pitch_approved', sourceId: 'test-big', xp: 1000 }));
  console.log(await getCreatorPoints(USER_ID));
  console.log(await getXpHistory({ userId: USER_ID, limit: 10 }));
};

main();
