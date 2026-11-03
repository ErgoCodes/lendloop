import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { ActivityList } from "@/components/activity-list";
import { CategoryIcon } from "@/components/category-icon";
import { SectionTitle } from "@/components/empty-state";
import { StatusBadge, TrustedBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatRange } from "@/lib/format";

type Loan = {
  tool: { name: string; category: string; deleted: boolean };
  startDate: string;
  endDate: string;
  message?: string;
  status: "requested" | "approved" | "rejected" | "cancelled" | "returned";
  isOverdue: boolean;
  activity: {
    kind: "request_notification" | "overdue_reminder";
    loanStatus?: string;
    at: number;
  }[];
};

export function LoanCard({
  loan,
  counterpart,
  actions,
}: {
  loan: Loan;
  counterpart: { label: string; name: string; trustedLender?: boolean };
  actions?: ReactNode;
}) {
  return (
    <Card className="py-4 transition-[border-color] duration-150 hover:border-mint-400/60">
      <CardContent className="flex flex-col gap-4 px-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="flex min-w-0 gap-3.5">
          <CategoryIcon category={loan.tool.category} />
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {loan.tool.name}
                {loan.tool.deleted && <span className="text-muted-foreground"> (removed)</span>}
              </span>
              <StatusBadge status={loan.status} overdue={loan.isOverdue} />
            </div>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="size-4" aria-hidden />
              {formatRange(loan.startDate, loan.endDate)}
            </p>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{counterpart.label}</span>
              <span className="font-medium">{counterpart.name}</span>
              {counterpart.trustedLender && <TrustedBadge />}
            </p>
            {loan.message && (
              <p className="rounded-lg border-l-2 border-mint-400 bg-mint-50 px-3 py-1.5 text-sm text-muted-foreground italic">
                “{loan.message}”
              </p>
            )}
            <ActivityList activity={loan.activity} />
          </div>
        </div>
        {actions && <div className="flex shrink-0 gap-2 sm:pl-0 pl-[3.625rem]">{actions}</div>}
      </CardContent>
    </Card>
  );
}

export function LoanSection({ title, children }: { title: string; children: ReactNode[] }) {
  if (children.length === 0) return null;
  return (
    <section className="space-y-3">
      <SectionTitle count={children.length}>{title}</SectionTitle>
      <div className="stagger grid items-start gap-3 xl:grid-cols-2">{children}</div>
    </section>
  );
}
