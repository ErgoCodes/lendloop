import { describe, expect, test } from "vitest";
import { diffLoanFeed, type Feed } from "./loan-notifications";

const item = (_id: string, status: string, otherParty = "bob") => ({
  _id,
  status,
  toolName: "Cordless drill",
  otherParty,
});
const feed = (incoming = [] as Feed["incoming"], mine = [] as Feed["mine"]): Feed => ({
  incoming,
  mine,
});

describe("diffLoanFeed", () => {
  test("the first snapshot never notifies", () => {
    expect(diffLoanFeed(undefined, feed([item("a", "requested")]))).toEqual([]);
  });

  test("a new request on my tool", () => {
    expect(diffLoanFeed(feed(), feed([item("a", "requested")]))).toEqual([
      { kind: "info", message: "bob requested your Cordless drill.", href: "/my/incoming" },
    ]);
  });

  test("a borrower cancels a pending request", () => {
    expect(
      diffLoanFeed(feed([item("a", "requested")]), feed([item("a", "cancelled")])),
    ).toMatchObject([{ kind: "warning", href: "/my/incoming" }]);
  });

  test("my request is approved or declined", () => {
    const prev = feed([], [item("a", "requested", "alice"), item("b", "requested", "alice")]);
    const next = feed([], [item("a", "approved", "alice"), item("b", "rejected", "alice")]);
    expect(diffLoanFeed(prev, next)).toEqual([
      {
        kind: "success",
        message: "alice approved your request for the Cordless drill.",
        href: "/my/requests",
      },
      {
        kind: "warning",
        message: "Your request for the Cordless drill was declined.",
        href: "/my/requests",
      },
    ]);
  });

  test("my own actions and unchanged loans are silent", () => {
    const prev = feed([item("a", "requested")], [item("b", "requested", "alice")]);
    // I approved an incoming request; I cancelled my own request.
    const next = feed([item("a", "approved")], [item("b", "cancelled", "alice")]);
    expect(diffLoanFeed(prev, next)).toEqual([]);
    expect(diffLoanFeed(next, next)).toEqual([]);
  });
});
