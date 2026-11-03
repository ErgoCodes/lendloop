"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SignInButton, UserButton } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCurrentUser } from "@/components/current-user-provider";
import { diffLoanFeed, type Feed } from "@/lib/loan-notifications";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/tools", label: "Browse tools" },
  { href: "/my/listings", label: "My listings" },
  { href: "/my/requests", label: "My requests" },
  { href: "/my/incoming", label: "Incoming" },
];

/** Live loan feed: toasts changes on any page and returns the pending count. */
function useLoanNotifications(): number {
  const router = useRouter();
  const { user } = useCurrentUser();
  const feed = useQuery(api.loans.notifications, user ? {} : "skip");
  const prev = useRef<{ userId: string; feed: Feed } | null>(null);

  useEffect(() => {
    if (!user || !feed) return;
    // Reset the baseline when the signed-in account changes.
    const baseline = prev.current?.userId === user._id ? prev.current.feed : undefined;
    for (const n of diffLoanFeed(baseline, feed)) {
      toast[n.kind](n.message, { action: { label: "View", onClick: () => router.push(n.href) } });
    }
    prev.current = { userId: user._id, feed };
  }, [user, feed, router]);

  return feed?.pendingIncoming ?? 0;
}

function NavLinks() {
  const pathname = usePathname();
  const { isAdmin } = useCurrentUser();
  const pending = useLoanNotifications();
  const items = isAdmin ? [...NAV, { href: "/admin", label: "Admin" }] : NAV;
  return (
    <nav
      className="order-last -mx-1 flex w-full items-center gap-1 overflow-x-auto px-1 text-sm md:order-none md:w-auto"
      aria-label="Main"
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={pathname.startsWith(item.href) ? "page" : undefined}
          className={cn(
            "inline-flex shrink-0 items-center rounded-full px-3.5 py-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground",
            "aria-[current=page]:bg-mint-200 aria-[current=page]:font-medium aria-[current=page]:text-accent-foreground",
          )}
        >
          {item.label}
          {item.href === "/my/incoming" && pending > 0 && (
            <Badge
              className="ml-1.5 h-5 min-w-5 bg-brand px-1.5 text-white tabular-nums"
              aria-label={`${pending} pending`}
            >
              {pending}
            </Badge>
          )}
        </Link>
      ))}
    </nav>
  );
}

function RoleBadge() {
  const { user } = useCurrentUser();
  if (!user || user.role !== "admin") return null;
  return <Badge variant="secondary">{user.isRoot ? "Root admin" : "Admin"}</Badge>;
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-6 lg:px-10 py-3">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.4)]">
            <RefreshCcw className="size-4" aria-hidden />
          </span>
          LendLoop
        </Link>
        <Authenticated>
          <NavLinks />
        </Authenticated>
        <div className="flex items-center gap-3">
          <AuthLoading>
            <div className="size-8 animate-pulse rounded-full bg-muted" />
          </AuthLoading>
          <Unauthenticated>
            <SignInButton mode="modal">
              <Button size="sm">Sign in</Button>
            </SignInButton>
          </Unauthenticated>
          <Authenticated>
            <RoleBadge />
            <UserButton />
          </Authenticated>
        </div>
      </div>
    </header>
  );
}
