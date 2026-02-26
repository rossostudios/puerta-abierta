import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedPageRoute = createRouteMatcher([
  "/app(.*)",
  "/setup(.*)",
  "/settings(.*)",
  "/module(.*)",
  "/account(.*)",
  "/documentation(.*)",
  "/invite(.*)",
]);

const isApiRoute = createRouteMatcher(["/api(.*)"]);
const isPublicApiRoute = createRouteMatcher([
  "/api/public(.*)",
  "/api/locale",
  "/api/sentry-example-api",
]);

const clerkProxy = clerkMiddleware(async (auth, req) => {
  const isProtected =
    isProtectedPageRoute(req) || (isApiRoute(req) && !isPublicApiRoute(req));

  if (isProtected) {
    await auth.protect();
  }
});

export default clerkProxy;
export const proxy = clerkProxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
