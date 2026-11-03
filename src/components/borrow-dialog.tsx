"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LIMITS } from "@convex/lib/constants";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { withToast } from "@/lib/errors";
import { formatRange, localToday } from "@/lib/format";

export function BorrowDialog({ toolId, toolName }: { toolId: Id<"tools">; toolName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Request to borrow</Button>
      </DialogTrigger>
      <DialogContent>
        <BorrowForm toolId={toolId} toolName={toolName} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open (reads "today" and the tool's bookings). */
function BorrowForm({
  toolId,
  toolName,
  onDone,
}: {
  toolId: Id<"tools">;
  toolName: string;
  onDone: () => void;
}) {
  const today = localToday();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const tool = useQuery(api.tools.get, { toolId });
  const request = useMutation(api.loans.request);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const ok = await withToast(
      () => request({ toolId, startDate, endDate, message: message || undefined }),
      "Request sent. The owner will be notified.",
    );
    setSubmitting(false);
    if (ok) onDone();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Borrow {toolName}</DialogTitle>
        <DialogDescription>
          Pick the days you need it (up to {LIMITS.maxLoanDays}). The owner approves or rejects your
          request.
        </DialogDescription>
      </DialogHeader>

      {tool && tool.bookings.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm">
          <p className="font-medium">Already booked</p>
          <ul className="mt-1 text-muted-foreground">
            {tool.bookings.map((b, i) => (
              <li key={i}>{formatRange(b.startDate, b.endDate)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="start">From</Label>
          <Input
            id="start"
            type="date"
            required
            min={today}
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (endDate < e.target.value) setEndDate(e.target.value);
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="end">Until</Label>
          <Input
            id="end"
            type="date"
            required
            min={startDate}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="message">Message to the owner (optional)</Label>
        <Textarea
          id="message"
          maxLength={LIMITS.requestMessage}
          placeholder="What do you need it for?"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Send request"}
        </Button>
      </DialogFooter>
    </form>
  );
}
