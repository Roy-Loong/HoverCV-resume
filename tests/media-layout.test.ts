import { describe, it, expect } from "vitest";
import { imageLayoutSchema, mediaSchema } from "../lib/schema";
import { imagePresentation } from "../lib/media-layout";

const oldMedia = {
  id: "legacy-photo",
  type: "image" as const,
  src: "data:image/png;base64,AAAA",
  caption: "旧项目的照片",
};

describe("照片展示设置与旧项目兼容", () => {
  it("旧照片无需迁移即可按原图比例完整显示", () => {
    const media = mediaSchema.parse(oldMedia);
    const presentation = imagePresentation(media);
    expect(presentation.frame.height).toBe("auto");
    expect(presentation.image).toMatchObject({
      height: "auto",
      objectFit: "contain",
      transform: "scale(1)",
    });
  });
  it("解析和序列化保留每张图片的焦点、缩放及显示高度", () => {
    const media = mediaSchema.parse({
      ...oldMedia,
      imageLayout: { fit: "cover", zoom: 1.8, x: 20, y: 80, height: 280 },
    });
    expect(mediaSchema.parse(JSON.parse(JSON.stringify(media)))).toEqual(media);
    expect(imagePresentation(media)).toEqual({
      frame: { height: "280px" },
      image: {
        height: "100%",
        objectFit: "cover",
        objectPosition: "20% 80%",
        transform: "scale(1.8)",
        transformOrigin: "20% 80%",
      },
    });
  });
  it.each([
    { zoom: 0 },
    { zoom: 4 },
    { x: -1 },
    { y: 101 },
    { height: 0 },
    { height: 481 },
    { height: "100%;position:fixed" },
    { fit: "fill" },
  ])("拒绝无效设置 %j", (invalid) => {
    expect(imageLayoutSchema.safeParse(invalid).success).toBe(false);
  });
});
