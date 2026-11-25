import { SCRAPE_WINDOW_DAYS, isInScrapeWindow } from '../src/service/postMetricsScrape/scrapeDay';

// Malaysia is UTC+8, so 10:00 MYT is 02:00 UTC on the same day.
const myt = (date: string, time = '10:00') => new Date(`${date}T${time}:00+08:00`);

describe('post scrape window', () => {
  const approved = { approvedAt: myt('2026-11-10') };

  it('is 7 days', () => {
    expect(SCRAPE_WINDOW_DAYS).toBe(7);
  });

  it('scrapes from the approval day through day 7', () => {
    expect(isInScrapeWindow(approved, myt('2026-11-10', '23:00'))).toBe(true);
    expect(isInScrapeWindow(approved, myt('2026-11-14', '00:00'))).toBe(true);
    expect(isInScrapeWindow(approved, myt('2026-11-17', '00:00'))).toBe(true);
  });

  it('stops on day 8', () => {
    expect(isInScrapeWindow(approved, myt('2026-11-18', '00:00'))).toBe(false);
    expect(isInScrapeWindow(approved, myt('2026-12-01'))).toBe(false);
  });

  it('never scrapes before approval', () => {
    expect(isInScrapeWindow(approved, myt('2026-11-09', '23:59'))).toBe(false);
  });

  it('counts days in Malaysia time', () => {
    // 23:59 MYT on the 10th is 15:59 UTC, still the 10th in Malaysia.
    const lateApproval = { approvedAt: myt('2026-11-10', '23:59') };
    expect(isInScrapeWindow(lateApproval, myt('2026-11-17', '00:00'))).toBe(true);
    expect(isInScrapeWindow(lateApproval, myt('2026-11-18', '00:00'))).toBe(false);
  });

  it('never scrapes a backfilled link, which has no approval time', () => {
    expect(isInScrapeWindow({ approvedAt: null }, myt('2026-11-10'))).toBe(false);
    expect(isInScrapeWindow({ approvedAt: undefined }, myt('2026-11-10'))).toBe(false);
  });

  it('restarts the window when the same link is approved again', () => {
    const reapproved = { approvedAt: myt('2026-11-20') };
    expect(isInScrapeWindow(approved, myt('2026-11-25'))).toBe(false);
    expect(isInScrapeWindow(reapproved, myt('2026-11-25'))).toBe(true);
    expect(isInScrapeWindow(reapproved, myt('2026-11-28', '00:00'))).toBe(false);
  });
});
