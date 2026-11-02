import { Badge } from "@/components/ui/badge";

type Status = "requested" | "approved" | "rejected" | "cancelled" | "returned";

const STYLES: Record<
  Status,
  { label: string; variant: React.ComponentProps<typeof Badge>["variant"] }
> = {
  requested: { label: "Pending", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
  returned: { label: "Returned", variant: "secondary" },
};

export function StatusBadge({ status, overdue }: { status: Status; overdue?: boolean }) {
  if (overdue) return <Badge variant="destructive">Overdue</Badge>;
  const s = STYLES[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function TrustedBadge() {
  return (
    <Badge variant="success" title="Marked as a Trusted Lender by an admin">
      ✓ Trusted lender
    </Badge>
  );
}
