import { z } from "zod";
import { COLOR_PRESETS } from "./colors";
export const rectSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export type Rect = z.infer<typeof rectSchema>;
export const safeUrl = z
  .string()
  .max(2048)
  .refine((v) => {
    try {
      return ["https:", "http:"].includes(new URL(v).protocol);
    } catch {
      return false;
    }
  }, "请输入 http(s) 链接");
const mediaUrl = z
  .string()
  .max(18_000_000)
  .refine(
    (v) =>
      /^data:(image\/(png|jpeg|webp|gif)|video\/(mp4|webm));base64,[A-Za-z0-9+/=]+$/.test(
        v,
      ),
    "仅支持嵌入的图片或视频",
  );
export const mediaSchema = z.object({
  id: z.string().max(80),
  type: z.enum(["image", "video"]),
  src: mediaUrl,
  caption: z.string().max(500),
});
export const annotationSchema = z.object({
  id: z.string().max(80),
  page: z.number().int().min(1).max(100),
  kind: z.enum(["text", "area"]),
  rects: z.array(rectSchema).min(1).max(200),
  text: z.string().max(2000),
  context: z.string().max(500),
  title: z.string().min(1).max(200),
  body: z.string().max(15000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  template: z.enum(["intro", "gallery", "cover"]),
  media: z.array(mediaSchema).max(30),
  links: z
    .array(z.object({ label: z.string().max(200), url: safeUrl }))
    .max(20),
  autoplay: z.boolean(),
  citations: z
    .array(z.object({ title: z.string().max(500), url: safeUrl }))
    .max(10),
  searchedAt: z.string().max(50).optional(),
});
export const projectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    name: z.string().min(1).max(150),
    pdfName: z.string().max(200),
    pdfHash: z.string().regex(/^[a-f0-9]{64}$/),
    pdfData: z
      .string()
      .max(45_000_000)
      .regex(/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/),
    annotations: z.array(annotationSchema).max(500),
    updatedAt: z.string().max(50),
    revision: z.number().int().nonnegative(),
    pages: z
      .array(
        z.object({
          width: z.number().positive().max(30000),
          height: z.number().positive().max(30000),
          image: z
            .string()
            .max(25_000_000)
            .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/),
          view: z.tuple([z.number(), z.number(), z.number(), z.number()]),
          rotation: z.number(),
          themeColor: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
          hasTheme: z.boolean().optional(),
        }),
      )
      .max(100),
  })
  .superRefine((p, ctx) => {
    for (const a of p.annotations) {
      if (a.page > p.pages.length)
        ctx.addIssue({ code: "custom", message: "注释页码无效" });
      for (const r of a.rects) {
        if (r[2] <= r[0] || r[3] <= r[1])
          ctx.addIssue({ code: "custom", message: "注释矩形无效" });
      }
    }
  });
export type Annotation = z.infer<typeof annotationSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Media = z.infer<typeof mediaSchema>;
export const COLORS = COLOR_PRESETS.map((p) => p.color);
export function newAnnotation(
  page: number,
  rects: Rect[],
  text: string,
  kind: "text" | "area",
): Annotation {
  return {
    id: crypto.randomUUID(),
    page,
    rects,
    text,
    context: text.slice(0, 500),
    kind,
    title: text.slice(0, 80) || "新的区域注释",
    body: "",
    color: COLORS[0],
    template: "intro",
    media: [],
    links: [],
    autoplay: false,
    citations: [],
  };
}
export function bytesToData(bytes: Uint8Array, type: string) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(s)}`;
}
export function dataToBytes(data: string) {
  const raw = atob(data.split(",")[1]);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export async function hashPdf(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
