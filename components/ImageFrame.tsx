import type { ComponentPropsWithRef } from "react";
import type { Media } from "@/lib/schema";
import { imagePresentation } from "@/lib/media-layout";

export default function ImageFrame({
  media,
  className = "",
  style,
  ...props
}: { media: Media } & ComponentPropsWithRef<"div">) {
  const presentation = imagePresentation(media);
  return (
    <div
      {...props}
      className={`media-viewport image-frame ${className}`}
      style={{ ...presentation.frame, ...style }}
    >
      <img
        src={media.src}
        alt={media.caption}
        draggable={false}
        style={presentation.image}
      />
    </div>
  );
}
