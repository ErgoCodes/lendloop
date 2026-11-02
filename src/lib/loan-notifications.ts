export type FeedItem = {
  _id: string;
  status: string;
  toolName: string;
  otherParty: string;
};

export type Feed = { incoming: FeedItem[]; mine: FeedItem[] };

export type LoanNotice = {
  kind: "info" | "success" | "warning";
  message: string;
  href: string;
};

/**
 * Compares two snapshots of the live loan feed and describes what changed
 * for the current user. The first snapshot (prev = undefined) yields nothing,
 * so opening the app never replays old activity.
 */
export function diffLoanFeed(prev: Feed | undefined, next: Feed): LoanNotice[] {
  if (!prev) return [];
  const notices: LoanNotice[] = [];

  const before = new Map(prev.incoming.map((l) => [l._id, l.status]));
  for (const l of next.incoming) {
    const was = before.get(l._id);
    if (was === undefined && l.status === "requested") {
      notices.push({
        kind: "info",
        message: `${l.otherParty} requested your ${l.toolName}.`,
        href: "/my/incoming",
      });
    } else if (was === "requested" && l.status === "cancelled") {
      notices.push({
        kind: "warning",
        message: `${l.otherParty} cancelled their request for your ${l.toolName}.`,
        href: "/my/incoming",
      });
    }
  }

  const mineBefore = new Map(prev.mine.map((l) => [l._id, l.status]));
  for (const l of next.mine) {
    const was = mineBefore.get(l._id);
    if (was !== "requested") continue;
    if (l.status === "approved") {
      notices.push({
        kind: "success",
        message: `${l.otherParty} approved your request for the ${l.toolName}.`,
        href: "/my/requests",
      });
    } else if (l.status === "rejected") {
      notices.push({
        kind: "warning",
        message: `Your request for the ${l.toolName} was declined.`,
        href: "/my/requests",
      });
    }
  }
  return notices;
}
