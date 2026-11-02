import { formatDate } from "@/lib/format";

type Availability =
  { state: "on_loan"; until: string } | { state: "available"; nextBookingStart?: string };

export function AvailabilityText({ availability }: { availability: Availability }) {
  if (availability.state === "on_loan") {
    return (
      <span className="text-sm text-muted-foreground">
        <span className="mr-1.5 inline-block size-2 rounded-full bg-warning" aria-hidden />
        On loan until {formatDate(availability.until)}
      </span>
    );
  }
  return (
    <span className="text-sm text-muted-foreground">
      <span className="mr-1.5 inline-block size-2 rounded-full bg-success" aria-hidden />
      Available now
      {availability.nextBookingStart &&
        ` · booked from ${formatDate(availability.nextBookingStart)}`}
    </span>
  );
}
