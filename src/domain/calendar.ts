export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function weekDates(date: string): string[] {
  const monday = new Date(`${date}T12:00:00`);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return localDate(d); });
}

export function generateDateRange(startDateStr: string, endDateStr: string): string[] {
  if (!startDateStr || !endDateStr) return [];
  const start = startDateStr <= endDateStr ? startDateStr : endDateStr;
  const end = startDateStr <= endDateStr ? endDateStr : startDateStr;
  const dates: string[] = [];
  const cur = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  while (cur <= endDate) {
    dates.push(localDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export function getRecentDays(baseDateStr: string, daysCount: number): string[] {
  if (daysCount <= 1) return [baseDateStr];
  const dates: string[] = [];
  const cur = new Date(`${baseDateStr}T12:00:00`);
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(cur);
    d.setDate(d.getDate() - i);
    dates.push(localDate(d));
  }
  return dates;
}
