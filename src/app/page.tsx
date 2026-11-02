import Link from "next/link";
import { SignInButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated } from "@/components/auth-gates";
import { ArrowRight } from "lucide-react";
import { PublicToolList } from "@/components/public-tool-list";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="flex flex-col items-start gap-4 pt-6">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">LendLoop</h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Lend what you have, borrow what you need. A tool-lending board for neighbours.
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
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Available in the loop</h2>
        <PublicToolList />
      </section>
    </div>
  );
}
