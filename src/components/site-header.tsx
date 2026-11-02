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
    <nav className="flex flex-wrap items-center gap-1 text-sm">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-md px-3 py-1.5 transition-colors hover:bg-accent",
            pathname.startsWith(item.href) && "bg-accent font-medium",
          )}
        >
          {item.label}
          {item.href === "/my/incoming" && pending > 0 && (
            <Badge className="ml-1.5 h-5 min-w-5 px-1.5" aria-label={`${pending} pending`}>
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
    <header className="border-b bg-card/60 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <RefreshCcw className="size-5 text-primary" aria-hidden />
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
