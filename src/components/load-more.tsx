"use client";

import { Button } from "@/components/ui/button";

type Status = "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

/** "Show more" button for usePaginatedQuery lists; hidden once everything is loaded. */
export function LoadMore({
  status,
  loadMore,
  pageSize,
}: {
  status: Status;
  loadMore: (n: number) => void;
  pageSize: number;
}) {
  if (status !== "CanLoadMore" && status !== "LoadingMore") return null;
  return (
    <div className="flex justify-center">
      <Button
        variant="outline"
        onClick={() => loadMore(pageSize)}
        disabled={status === "LoadingMore"}
      >
        {status === "LoadingMore" ? "Loading…" : "Show more"}
      </Button>
    </div>
  );
}
