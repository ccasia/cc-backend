export interface FieldChange {
  field: string;
  label: string;
  old: any;
  new: any;
}

export interface FieldMapping {
  field: string;
  label: string;
  source?: string; // dot-path for nested values (e.g. "campaignBrief.startDate")
}

function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((curr, key) => curr?.[key], obj);
}

function normalizeValue(val: any): any {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') {
    // Check if it's a date string
    const d = new Date(val);
    if (!isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(val)) {
      return d.toISOString();
    }
  }
  if (Array.isArray(val)) return JSON.stringify([...val].sort());
  return val;
}

function formatForDisplay(val: any): any {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(val)) {
      return d.toISOString().split('T')[0];
    }
  }
  if (Array.isArray(val)) return val;
  if (typeof val === 'boolean') return val;
  return val;
}

export function computeChanges(
  oldData: Record<string, any>,
  newData: Record<string, any>,
  fields: FieldMapping[]
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const mapping of fields) {
    const newVal = newData[mapping.field];

    // Skip if the field wasn't submitted in the update
    if (newVal === undefined) continue;

    const oldVal = mapping.source ? getNestedValue(oldData, mapping.source) : oldData[mapping.field];

    const normalizedOld = normalizeValue(oldVal);
    const normalizedNew = normalizeValue(newVal);

    if (normalizedOld !== normalizedNew) {
      changes.push({
        field: mapping.field,
        label: mapping.label,
        old: formatForDisplay(oldVal),
        new: formatForDisplay(newVal),
      });
    }
  }

  return changes;
}
