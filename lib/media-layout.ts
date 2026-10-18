import type { ImageLayout, Media } from "./schema";

export const DEFAULT_IMAGE_LAYOUT: ImageLayout = {
  fit: "contain",
  zoom: 1,
  x: 50,
  y: 50,
  height: "auto",
};

export function imageLayout(media: Media): ImageLayout {
  return { ...DEFAULT_IMAGE_LAYOUT, ...media.imageLayout };
}

// Both the editor and self-contained readers use these exact styles. Scaling
// about the object-position keeps each 0–100% position at the visible bounds.
export function imagePresentation(media: Media) {
  const layout = imageLayout(media);
  return {
    frame: { height: layout.height === "auto" ? "auto" : `${layout.height}px` },
    image: {
      height: layout.height === "auto" ? "auto" : "100%",
      objectFit: layout.fit,
      objectPosition: `${layout.x}% ${layout.y}%`,
      transform: `scale(${layout.zoom})`,
      transformOrigin: `${layout.x}% ${layout.y}%`,
    },
  };
}
