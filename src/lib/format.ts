import { format, formatDistanceToNow, parseISO } from "date-fns";

export function formatDate(iso: string) {
  return format(parseISO(iso), "MMM d, yyyy");
}

export function formatRange(start: string, end: string) {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
}

export function timeAgo(ms: number) {
  return formatDistanceToNow(ms, { addSuffix: true });
}

/** Local calendar date as YYYY-MM-DD (for <input type="date">). */
export function localToday() {
  return format(new Date(), "yyyy-MM-dd");
}
