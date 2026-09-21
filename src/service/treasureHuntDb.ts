export const lockTreasureHunt = async (tx: any, huntId: string): Promise<boolean> => {
  const rows = (await tx.$queryRaw`
    SELECT "id"
    FROM "TreasureHunt"
    WHERE "id" = ${huntId}
    FOR UPDATE
  `) as { id: string }[];

  return rows.length === 1;
};

// All callers lock the parent hunt first so claim and admin mutations use one
// deterministic lock order and cannot deadlock each other.
export const lockTreasureHuntLocation = async (tx: any, huntId: string, locationId: string): Promise<boolean> => {
  const rows = (await tx.$queryRaw`
    SELECT "id"
    FROM "TreasureHuntLocation"
    WHERE "id" = ${locationId} AND "huntId" = ${huntId}
    FOR UPDATE
  `) as { id: string }[];

  return rows.length === 1;
};
