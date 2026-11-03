import Link from "next/link";
import { SignInButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated } from "@/components/auth-gates";
import { ArrowRight, CalendarCheck, HandHeart, Search } from "lucide-react";
import { PublicToolList } from "@/components/public-tool-list";
import { Button } from "@/components/ui/button";
import { getInitialPublicTools } from "@/lib/public-tools.server";

const STEPS = [
  {
    icon: Search,
    title: "Find it",
    body: "Search what neighbours are lending by name or category.",
  },
  {
    icon: CalendarCheck,
    title: "Request dates",
    body: "Pick the days you need it; the owner approves.",
  },
  { icon: HandHeart, title: "Give back", body: "Return it on time and list your own tools too." },
];

export default async function Home() {
  const initialTools = await getInitialPublicTools();
  return (
    <div className="space-y-14">
      <section className="hero-wash relative overflow-hidden rounded-3xl border px-6 py-12 sm:px-12 sm:py-16">
        <div className="flex max-w-2xl flex-col items-start gap-5">
          <span className="rounded-full border border-mint-400/60 bg-card/70 px-3 py-1 text-xs font-medium text-brand">
            A tool-lending board for neighbours
          </span>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Lend what you have, borrow what you need.
          </h1>
          <p className="max-w-xl text-lg text-pretty text-muted-foreground">
            That drill you use twice a year? Someone down the street needs it today. Share tools,
            skip the store, keep things in the loop.
          </p>
          <Unauthenticated>
            <SignInButton mode="modal">
              <Button size="lg">Sign in to lend or borrow</Button>
            </SignInButton>
          </Unauthenticated>
          <Authenticated>
            <Button size="lg" asChild>
              <Link href="/tools">
                Browse tools <ArrowRight />
              </Link>
            </Button>
          </Authenticated>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3" aria-label="How it works">
        {STEPS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex gap-3.5 rounded-2xl border bg-card p-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-mint-200/70 text-brand">
              <Icon className="size-5" aria-hidden />
            </span>
            <div className="space-y-1">
              <h2 className="font-medium">{title}</h2>
              <p className="text-sm text-muted-foreground">{body}</p>
            </div>
          </div>
        ))}
      </section>

      <Unauthenticated>
        <section className="space-y-5">
          <h2 className="text-2xl font-semibold tracking-tight">Available in the loop</h2>
          <PublicToolList initialTools={initialTools} />
        </section>
      </Unauthenticated>
    </div>
  );
}
