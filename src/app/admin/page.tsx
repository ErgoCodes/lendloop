"use client";

import { useMutation, useQuery } from "convex/react";
import { ShieldCheck, ShieldOff, Star, StarOff, Undo2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { useCurrentUser } from "@/components/current-user-provider";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { withToast } from "@/lib/errors";
import { formatRange, timeAgo } from "@/lib/format";

function UsersTable() {
  const { user: me } = useCurrentUser();
  const users = useQuery(api.users.list);
  const setRole = useMutation(api.users.setRole);
  const setTrusted = useMutation(api.users.setTrustedLender);

  if (users === undefined) return <Skeleton className="h-40" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Joined</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((u) => (
          <TableRow key={u._id}>
            <TableCell>
              <div className="font-medium">{u.name}</div>
              <div className="text-xs text-muted-foreground">{u.email}</div>
            </TableCell>
            <TableCell className="space-x-1">
              <Badge variant={u.role === "admin" ? "default" : "outline"}>
                {u.isRoot ? "root admin" : u.role}
              </Badge>
              {u.trustedLender && <Badge variant="success">trusted</Badge>}
            </TableCell>
            <TableCell className="text-muted-foreground">{timeAgo(u._creationTime)}</TableCell>
            <TableCell className="space-x-2 text-right">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  withToast(
                    () => setTrusted({ userId: u._id, trusted: !u.trustedLender }),
                    u.trustedLender ? "Trusted Lender removed." : "Marked as Trusted Lender.",
                  )
                }
              >
                {u.trustedLender ? <StarOff /> : <Star />}
                {u.trustedLender ? "Untrust" : "Trust"}
              </Button>
              {!u.isRoot && u._id !== me?._id && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    withToast(
                      () => setRole({ userId: u._id, role: u.role === "admin" ? "user" : "admin" }),
                      u.role === "admin" ? "Admin rights removed." : "Promoted to admin.",
                    )
                  }
                >
                  {u.role === "admin" ? <ShieldOff /> : <ShieldCheck />}
                  {u.role === "admin" ? "Demote" : "Make admin"}
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function LoansTable() {
  const loans = useQuery(api.loans.all);
  const markReturned = useMutation(api.loans.markReturned);

  if (loans === undefined) return <Skeleton className="h-40" />;
  if (loans.length === 0) return <EmptyState title="No loans yet" />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tool</TableHead>
          <TableHead>Owner → Borrower</TableHead>
          <TableHead>Dates</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loans.map((l) => (
          <TableRow key={l._id}>
            <TableCell className="font-medium">{l.tool.name}</TableCell>
            <TableCell>
              {l.owner.name} → {l.borrower.name}
            </TableCell>
            <TableCell>{formatRange(l.startDate, l.endDate)}</TableCell>
            <TableCell>
              <StatusBadge status={l.status} overdue={l.isOverdue} />
            </TableCell>
            <TableCell className="text-right">
              {l.status === "approved" && l.hasStarted && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    withToast(() => markReturned({ loanId: l._id }), "Marked as returned.")
                  }
                >
                  <Undo2 /> Mark returned
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function AdminPage() {
  const { isLoading, isAdmin } = useCurrentUser();
  if (isLoading) return <Skeleton className="h-64" />;
  if (!isAdmin) {
    return <EmptyState title="Admins only">You don&apos;t have access to this page.</EmptyState>;
  }
  return (
    <div className="space-y-10">
      <PageHeader title="Admin" description="Manage people and oversee every loan." />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Users</h2>
        <UsersTable />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">All loans</h2>
        <LoansTable />
      </section>
    </div>
  );
}
