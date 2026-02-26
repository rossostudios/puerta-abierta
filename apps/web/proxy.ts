import { clerkMiddleware } from "@clerk/nextjs/server";

const clerkProxy = clerkMiddleware();

export default clerkProxy;
export const proxy = clerkProxy;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
