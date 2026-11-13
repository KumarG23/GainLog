const eastern = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function parts(value: Date) {
  const items = eastern.formatToParts(value);
  const n = (key: string) => Number(items.find(p => p.type === key)?.value);
  return { year: n('year'), month: n('month'), day: n('day'), hour: n('hour'), minute: n('minute') };
}
export function buildBpReminderPlan(now: Date, horizonDays = 14): Date[] {
  const today = parts(now), result: Date[] = [];
  for (let i = 0; i < horizonDays; i++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + i, 8));
    if (![2, 6].includes(day.getUTCDay())) continue;
    const p = parts(day);
    const displayed = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const at = new Date(day.getTime() + (day.getTime() - displayed));
    if (at > now) result.push(at);
  }
  return result;
}
