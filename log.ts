import dayjs from 'dayjs';

function countBusinessDays(startDate: string, endDate: string): number {
  let start = dayjs(startDate);
  const end = dayjs(endDate);
  let count = 0;

  while (start.isBefore(end, 'day')) {
    const day = start.day(); // 0 = Sunday, 6 = Saturday
    if (day !== 0 && day !== 6) {
      count++;
    }
    start = start.add(1, 'day');
  }
  return count;
}

console.log(countBusinessDays('2025-09-22', '2025-10-02')); // 5
