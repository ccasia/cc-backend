// Neutralize CSV/formula injection: a leading =, +, -, or @ can execute in
// spreadsheet apps, so prefix those with a single quote. Also quote fields
// containing commas, quotes, or newlines.
export const escapeCsvField = (value: unknown): string => {
  let field = value === null || value === undefined ? '' : String(value);

  if (/^[=+\-@]/.test(field)) {
    field = `'${field}`;
  }

  if (/[",\n\r]/.test(field)) {
    field = `"${field.replace(/"/g, '""')}"`;
  }

  return field;
};

export interface ParticipantCsvRow {
  name: string | null;
  email: string | null;
  locationName: string;
  source: string;
  claimedAt: Date;
}

const HEADER = ['Name', 'Email', 'Location', 'Source', 'Claimed At'];

export const toParticipantsCsv = (rows: ParticipantCsvRow[]): string => {
  const lines = [HEADER.join(',')];
  for (const row of rows) {
    lines.push(
      [
        escapeCsvField(row.name),
        escapeCsvField(row.email),
        escapeCsvField(row.locationName),
        escapeCsvField(row.source),
        escapeCsvField(row.claimedAt.toISOString()),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
};
