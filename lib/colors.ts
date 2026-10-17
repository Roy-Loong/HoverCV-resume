// Muted and light alternatives; custom colors remain available.
export const COLOR_PRESETS = [
  { color: "#8771b3", name: "柔雾紫" },
  { color: "#6d8db4", name: "雾霾蓝" },
  { color: "#52978c", name: "青瓷绿" },
  { color: "#829663", name: "鼠尾草" },
  { color: "#ad8c55", name: "暖沙金" },
  { color: "#b17d8d", name: "豆沙粉" },
  { color: "#a08bbd", name: "浅藤紫" },
  { color: "#8da9c4", name: "晴空蓝" },
  { color: "#83afa4", name: "薄荷绿" },
  { color: "#a4b489", name: "浅苔绿" },
  { color: "#c7ac80", name: "燕麦金" },
  { color: "#c7a0ad", name: "樱花粉" },
];

export function recommendPdfColor(pixels: ArrayLike<number>) {
  const buckets = new Map<
    string,
    { count: number; r: number; g: number; b: number }
  >();
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i],
      g = pixels[i + 1],
      b = pixels[i + 2];
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    // Ignore paper, neutral text and near-black pixels.
    if (pixels[i + 3] < 128 || max - min < 24 || max < 45 || min > 235)
      continue;
    const key = [r, g, b].map((n) => Math.floor(n / 32)).join(",");
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const top = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  if (!top) return { color: COLOR_PRESETS[0].color, hasTheme: false };
  const [r, g, b] = [top.r, top.g, top.b].map((n) => n / top.count / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  let hue =
    max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  // Keep the PDF hue, soften its saturation, and retain readable text on white.
  const saturation = 0.3,
    lightness = 0.52;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const rgb =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const offset = lightness - chroma / 2;
  return {
    color:
      "#" +
      rgb
        .map((n) =>
          Math.round((n + offset) * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join(""),
    hasTheme: true,
  };
}
