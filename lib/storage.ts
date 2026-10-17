import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { HttpError } from "./server";
import { putLocal, getLocal, deleteLocal } from "./storage-local";
let client: S3Client | undefined;
function storage() {
  if (
    !process.env.S3_ENDPOINT ||
    !process.env.S3_ACCESS_KEY_ID ||
    !process.env.S3_SECRET_ACCESS_KEY ||
    !process.env.S3_BUCKET
  )
    throw new HttpError(503, "私有文件存储尚未配置");
  return (client ??= new S3Client({
    region: process.env.S3_REGION || "us-east-1",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  }));
}
export async function putObject(key: string, body: string, type: string) {
  if (process.env.STORAGE_DRIVER === "local") return putLocal(key, body);
  await storage().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: type,
    }),
  );
}
export async function getObject(key: string) {
  if (process.env.STORAGE_DRIVER === "local") return getLocal(key);
  const r = await storage().send(
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
  );
  if (!r.Body) throw new HttpError(404, "文件不存在");
  return r.Body.transformToString();
}
export async function deleteObject(key: string) {
  if (process.env.STORAGE_DRIVER === "local") return deleteLocal(key);
  await storage().send(
    new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
  );
}
