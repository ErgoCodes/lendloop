import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Pages that require a signed-in user. Real authorization happens in Convex;
// this only redirects anonymous visitors to the sign-in page.
const isProtectedRoute = createRouteMatcher(["/tools(.*)", "/my(.*)", "/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
