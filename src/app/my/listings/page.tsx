"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AvailabilityText } from "@/components/availability";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { ToolFormDialog } from "@/components/tool-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/components/current-user-provider";
import { withToast } from "@/lib/errors";

export default function MyListingsPage() {
  const { user } = useCurrentUser();
  const tools = useQuery(api.tools.mine, user ? {} : "skip");
  const removeTool = useMutation(api.tools.remove);

  async function onDelete(toolId: Id<"tools">, name: string) {
    if (!confirm(`Delete "${name}"? Pending requests will be rejected.`)) return;
    await withToast(() => removeTool({ toolId }), "Listing deleted.");
  }

  return (
    <>
      <PageHeader
        title="My listings"
        description="Tools you lend to the loop."
        action={
          <ToolFormDialog
            trigger={
              <Button>
                <Plus /> List a tool
              </Button>
            }
          />
        }
      />
      {tools === undefined ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : tools.length === 0 ? (
        <EmptyState title="You haven't listed anything yet">
          Got a drill or a ladder gathering dust? List it so neighbours can borrow it.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {tools.map((t) => (
            <Card key={t._id} className="gap-4">
              <CardHeader>
                <CardTitle>{t.name}</CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{t.category}</Badge>
                  <span>Condition: {t.condition}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <AvailabilityText availability={t.availability} />
                {t.pendingRequests > 0 && (
                  <p className="text-sm">
                    <Link href="/my/incoming" className="font-medium text-primary hover:underline">
                      {t.pendingRequests} pending request{t.pendingRequests > 1 ? "s" : ""}
                    </Link>
                  </p>
                )}
              </CardContent>
              <CardFooter className="gap-2">
                <ToolFormDialog
                  tool={t}
                  trigger={
                    <Button size="sm" variant="outline">
                      <Pencil /> Edit
                    </Button>
                  }
                />
                <Button size="sm" variant="ghost" onClick={() => onDelete(t._id, t.name)}>
                  <Trash2 /> Delete
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
