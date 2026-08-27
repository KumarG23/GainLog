function localDateParts(value: Date) {
  return [value.getFullYear(), value.getMonth(), value.getDate()] as const;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  const a = localDateParts(left);
  const b = localDateParts(right);
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function formatSyncTimestamp(value: string, now = new Date()): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return 'Unknown';

  const time = timestamp.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (isSameLocalDay(timestamp, now)) return `Today, ${time}`;

  const date = timestamp.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return `${date}, ${time}`;
}
