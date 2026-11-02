import { BellRing, Mail } from "lucide-react";
import { timeAgo } from "@/lib/format";

type Activity = {
  kind: "request_notification" | "overdue_reminder";
  loanStatus?: string;
  at: number;
};

function label(a: Activity) {
  if (a.kind === "overdue_reminder") return "Reminder sent";
  switch (a.loanStatus) {
    case "requested":
      return "Owner notified of request";
    case "approved":
      return "Borrower notified: approved";
    case "rejected":
      return "Borrower notified: rejected";
    case "cancelled":
      return "Owner notified: cancelled";
    case "returned":
      return "Borrower notified: returned";
    default:
      return "Notification sent";
  }
}

/** Automation history for one loan, written back by the n8n workflows. */
export function ActivityList({ activity }: { activity: Activity[] }) {
  if (activity.length === 0) return null;
  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {activity.slice(0, 3).map((a, i) => (
        <li key={i} className="flex items-center gap-1.5">
          {a.kind === "overdue_reminder" ? (
            <BellRing className="size-3.5" aria-hidden />
          ) : (
            <Mail className="size-3.5" aria-hidden />
          )}
          {label(a)} {timeAgo(a.at)}
        </li>
      ))}
    </ul>
  );
}
