"use client";

import Link from "next/link";
import { useMutation, usePaginatedQuery } from "convex/react";
import { PackageOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AvailabilityText } from "@/components/availability";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { LoadMore } from "@/components/load-more";
import { ToolFormDialog } from "@/components/tool-form-dialog";
import { ToolCard } from "@/components/tool-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/components/current-user-provider";
import { withToast } from "@/lib/errors";

const PAGE_SIZE = 24;

export default function MyListingsPage() {
  const { user } = useCurrentUser();
  const {
    results: tools,
    status,
    loadMore,
  } = usePaginatedQuery(api.tools.mine, user ? {} : "skip", { initialNumItems: PAGE_SIZE });
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
      {status === "LoadingFirstPage" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : tools.length === 0 ? (
        <EmptyState title="You haven't listed anything yet" icon={<PackageOpen />}>
          Got a drill or a ladder gathering dust? List it so neighbours can borrow it.
        </EmptyState>
      ) : (
        <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {tools.map((t) => (
            <ToolCard
              key={t._id}
              name={t.name}
              category={t.category}
              condition={t.condition}
              footer={
                <>
                  <ToolFormDialog
                    tool={t}
                    trigger={
                      <Button size="sm" variant="outline">
                        <Pencil /> Edit
                      </Button>
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(t._id, t.name)}
                  >
                    <Trash2 /> Delete
                  </Button>
                </>
              }
            >
              <AvailabilityText availability={t.availability} />
              {t.pendingRequests > 0 && (
                <p className="text-sm">
                  <Link
                    href="/my/incoming"
                    className="inline-flex items-center gap-1.5 rounded-full bg-warning/20 px-2.5 py-0.5 font-medium text-[oklch(0.42_0.09_70)] transition-colors hover:bg-warning/30"
                  >
                    {t.pendingRequests} pending request{t.pendingRequests > 1 ? "s" : ""} →
                  </Link>
                </p>
              )}
            </ToolCard>
          ))}
        </div>
      )}
      <div className="mt-8">
        <LoadMore status={status} loadMore={loadMore} pageSize={PAGE_SIZE} />
      </div>
    </>
  );
}
