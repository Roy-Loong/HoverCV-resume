import { APP_VERSION } from "@/lib/version";
export async function GET() {
  return Response.json({
    version: APP_VERSION,
    cloud: !!(
      process.env.DATABASE_URL &&
      process.env.BETTER_AUTH_SECRET &&
      process.env.BETTER_AUTH_URL &&
      (process.env.STORAGE_DRIVER === "local" ||
        (process.env.S3_ENDPOINT &&
          process.env.S3_ACCESS_KEY_ID &&
          process.env.S3_SECRET_ACCESS_KEY &&
          process.env.S3_BUCKET))
    ),
    ai: !!(
      process.env.AI_API_KEY &&
      process.env.TAVILY_API_KEY &&
      process.env.AI_MODEL
    ),
  });
}
