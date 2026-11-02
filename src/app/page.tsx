import { SignInButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <section className="flex flex-col items-start gap-4 py-12">
      <h1 className="text-4xl font-bold tracking-tight">LendLoop</h1>
      <p className="text-lg text-muted-foreground">Lend what you have, borrow what you need.</p>
      <SignInButton mode="modal">
        <Button size="lg">Sign in to lend or borrow</Button>
      </SignInButton>
    </section>
  );
}
