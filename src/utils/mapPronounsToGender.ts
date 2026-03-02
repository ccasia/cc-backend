// Utility to map pronouns to normalized gender values
export const mapPronounsToGender = (pronouns?: string | null): string | null => {
  if (!pronouns) {
    return null;
  }

  const normalizedPronouns = pronouns.toLowerCase().replace(/\s+/g, '');

  if (normalizedPronouns === 'he/him') {
    return 'Male';
  }

  if (normalizedPronouns === 'she/her') {
    return 'Female';
  }

  if (normalizedPronouns === 'they/them') {
    return 'Non-Binary';
  }

  return null;
};
