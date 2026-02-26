export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      ok: false,
      message: "Sentry example route disabled for AWS ECS migration baseline.",
    },
    { status: 503 }
  );
}
