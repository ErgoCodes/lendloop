"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useCurrentUser } from "@/components/current-user-provider";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { LoanCard, LoanSection } from "@/components/loan-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { withToast } from "@/lib/errors";

export default function MyRequestsPage() {
  const { user } = useCurrentUser();
  const loans = useQuery(api.loans.myRequests, user ? {} : "skip");
  const cancel = useMutation(api.loans.cancel);

  const header = <PageHeader title="My requests" description="Tools you've asked to borrow." />;
  if (loans === undefined) {
    return (
      <>
        {header}
        <Skeleton className="h-28" />
      </>
    );
  }
  if (loans.length === 0) {
    return (
      <>
        {header}
        <EmptyState title="No requests yet">
          <Link href="/tools" className="text-primary hover:underline">
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
      <LoanSection title="History">
        {loans.filter((l) => !["requested", "approved"].includes(l.status)).map(card)}
      </LoanSection>
    </div>
  );
}
