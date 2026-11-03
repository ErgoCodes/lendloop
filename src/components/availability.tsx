import { formatDate } from "@/lib/format";

type Availability =
  { state: "on_loan"; until: string } | { state: "available"; nextBookingStart?: string };

export function AvailabilityText({ availability }: { availability: Availability }) {
  if (availability.state === "on_loan") {
    return (
      <span className="inline-flex items-center text-sm text-muted-foreground">
        <span
          className="mr-1.5 inline-block size-2 rounded-full bg-warning ring-3 ring-warning/20"
          aria-hidden
        />
        On loan until {formatDate(availability.until)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-sm text-muted-foreground">
      <span
        className="mr-1.5 inline-block size-2 rounded-full bg-mint-400 ring-3 ring-mint-400/25"
        aria-hidden
      />
      Available now
      {availability.nextBookingStart &&
        ` · booked from ${formatDate(availability.nextBookingStart)}`}
    </span>
  );
}
