"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInButton, UserButton } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCurrentUser } from "@/components/current-user-provider";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/tools", label: "Browse tools" },
  { href: "/my/listings", label: "My listings" },
  { href: "/my/requests", label: "My requests" },
  { href: "/my/incoming", label: "Incoming" },
];

function NavLinks() {
  const pathname = usePathname();
  const { isAdmin } = useCurrentUser();
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
