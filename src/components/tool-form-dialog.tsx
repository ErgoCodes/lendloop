"use client";

import { useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORIES, CONDITIONS, LIMITS } from "@convex/lib/constants";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { withToast } from "@/lib/errors";

type ToolValues = { name: string; category: string; condition: string; description: string };

const EMPTY: ToolValues = { name: "", category: "", condition: "", description: "" };

export function ToolFormDialog({
  tool,
  trigger,
}: {
  /** Pass an existing tool to edit it; omit to create a new one. */
  tool?: ToolValues & { _id: Id<"tools"> };
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ToolValues>(tool ?? EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);

  const set = (field: keyof ToolValues) => (value: string) =>
    setValues((v) => ({ ...v, [field]: value }));

  function onOpenChange(next: boolean) {
    if (next) setValues(tool ?? EMPTY);
    setOpen(next);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const ok = await withToast(
      () => (tool ? update({ toolId: tool._id, ...values }) : create(values)),
      tool ? "Listing updated." : "Tool listed.",
    );
    setSubmitting(false);
    if (ok) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{tool ? "Edit listing" : "List a tool"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="tool-name">Name</Label>
            <Input
              id="tool-name"
              required
              maxLength={LIMITS.toolName}
              placeholder="e.g. Cordless drill"
              value={values.name}
              onChange={(e) => set("name")(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Select required value={values.category} onValueChange={set("category")}>
                <SelectTrigger aria-label="Category">
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Condition</Label>
              <Select required value={values.condition} onValueChange={set("condition")}>
                <SelectTrigger aria-label="Condition">
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tool-description">Description</Label>
            <Textarea
              id="tool-description"
              maxLength={LIMITS.description}
              placeholder="Anything a borrower should know (accessories, quirks, pickup)."
              value={values.description}
              onChange={(e) => set("description")(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting || !values.category || !values.condition}>
              {submitting ? "Saving…" : tool ? "Save changes" : "List tool"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
