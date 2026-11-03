"use client";

import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Inbox } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useCurrentUser } from "@/components/current-user-provider";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { LoadMore } from "@/components/load-more";
import { LoanCard, LoanSection } from "@/components/loan-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { withToast } from "@/lib/errors";

const HISTORY_PAGE = 20;

export default function MyRequestsPage() {
  const { user } = useCurrentUser();
  const loans = useQuery(api.loans.myRequests, user ? {} : "skip");
  const history = usePaginatedQuery(api.loans.myRequestsHistory, user ? {} : "skip", {
    initialNumItems: HISTORY_PAGE,
  });
  const cancel = useMutation(api.loans.cancel);

  const header = <PageHeader title="My requests" description="Tools you've asked to borrow." />;
  if (loans === undefined || history.status === "LoadingFirstPage") {
    return (
      <>
        {header}
        <div className="space-y-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </>
    );
  }
  // A filtered page can come back empty before the end, so wait for "Exhausted".
  if (loans.length === 0 && history.results.length === 0 && history.status === "Exhausted") {
    return (
      <>
        {header}
        <EmptyState title="No requests yet" icon={<Inbox />}>
          <Link href="/tools" className="text-brand underline-offset-4 hover:underline">
            Browse tools
          </Link>{" "}
          to borrow something.
        </EmptyState>
      </>
    );
  }

  const card = (l: (typeof loans)[number]) => (
    <LoanCard
      key={l._id}
      loan={l}
      counterpart={{ label: "Owner", ...l.owner }}
      actions={
        l.status === "requested" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => withToast(() => cancel({ loanId: l._id }), "Request cancelled.")}
          >
            Cancel request
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="space-y-8">
      {header}
      <LoanSection title="Pending">
        {loans.filter((l) => l.status === "requested").map(card)}
      </LoanSection>
      <LoanSection title="Borrowing">
        {loans.filter((l) => l.status === "approved").map(card)}
      </LoanSection>
      <LoanSection title="History">{history.results.map(card)}</LoanSection>
      <LoadMore status={history.status} loadMore={history.loadMore} pageSize={HISTORY_PAGE} />
    </div>
  );
}
