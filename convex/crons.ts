import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("purge expired HTTP nonces", { hours: 1 }, internal.httpNonces.purgeExpired, {});

export default crons;
