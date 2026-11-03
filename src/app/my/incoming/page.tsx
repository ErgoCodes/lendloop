"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Check, Inbox, Undo2, X } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useCurrentUser } from "@/components/current-user-provider";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { LoadMore } from "@/components/load-more";
import { LoanCard, LoanSection } from "@/components/loan-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { withToast } from "@/lib/errors";

const HISTORY_PAGE = 20;

export default function IncomingPage() {
  const { user } = useCurrentUser();
  const loans = useQuery(api.loans.incoming, user ? {} : "skip");
  const history = usePaginatedQuery(api.loans.incomingHistory, user ? {} : "skip", {
    initialNumItems: HISTORY_PAGE,
  });
  const approve = useMutation(api.loans.approve);
  const reject = useMutation(api.loans.reject);
  const markReturned = useMutation(api.loans.markReturned);

  const header = (
    <PageHeader title="Incoming requests" description="Requests and loans for tools you lend." />
  );
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
        <EmptyState title="No requests for your tools yet" icon={<Inbox />}>
          When a neighbour asks to borrow one of your tools, it shows up here.
        </EmptyState>
      </>
    );
  }

  const card = (l: (typeof loans)[number]) => (
    <LoanCard
      key={l._id}
      loan={l}
      counterpart={{ label: "Borrower", ...l.borrower }}
      actions={
        l.status === "requested" ? (
          <>
            <Button
              size="sm"
              onClick={() => withToast(() => approve({ loanId: l._id }), "Request approved.")}
            >
              <Check /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => withToast(() => reject({ loanId: l._id }), "Request rejected.")}
            >
              <X /> Reject
            </Button>
          </>
        ) : l.status === "approved" && l.hasStarted ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => withToast(() => markReturned({ loanId: l._id }), "Marked as returned.")}
          >
            <Undo2 /> Mark returned
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="space-y-8">
      {header}
      <LoanSection title="Waiting for you">
        {loans.filter((l) => l.status === "requested").map(card)}
      </LoanSection>
      <LoanSection title="Lent out">
        {loans.filter((l) => l.status === "approved").map(card)}
      </LoanSection>
      <LoanSection title="History">{history.results.map(card)}</LoanSection>
      <LoadMore status={history.status} loadMore={history.loadMore} pageSize={HISTORY_PAGE} />
    </div>
  );
}
