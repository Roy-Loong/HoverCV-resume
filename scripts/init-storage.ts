import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutPublicAccessBlockCommand,
} from "@aws-sdk/client-s3";
async function main() {
  const c = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    }),
    Bucket = process.env.S3_BUCKET!;
  try {
    await c.send(new HeadBucketCommand({ Bucket }));
  } catch {
    await c.send(new CreateBucketCommand({ Bucket }));
  }
  console.log("私有桶已准备，请勿设置 public policy");
}
main().catch((e) => {
  console.error(e.name);
  process.exitCode = 1;
});
