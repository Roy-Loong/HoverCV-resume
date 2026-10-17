import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFile } from "node:fs/promises";
async function main() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Alex Morgan — fictional demo resume");
  pdf.setAuthor("HoverCV fictional sample");
  const page = pdf.addPage([595, 842]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.17, 0.17, 0.2),
    muted = rgb(0.46, 0.46, 0.5),
    violet = rgb(0.41, 0.34, 0.83);
  const text = (
    s: string,
    x: number,
    y: number,
    size = 10,
    b = false,
    color = ink,
  ) => page.drawText(s, { x, y, size, font: b ? bold : regular, color });
  const line = (y: number) =>
    page.drawLine({
      start: { x: 46, y },
      end: { x: 549, y },
      thickness: 0.65,
      color: rgb(0.88, 0.87, 0.9),
    });
  text("ALEX MORGAN", 46, 770, 31, true);
  text("PRODUCT DESIGNER & VISUAL STORYTELLER", 46, 743, 9, true, muted);
  text("Shanghai, China  /  alex@example.com", 46, 713, 9, false, muted);
  text("SELECTED RESUME", 436, 775, 8, true, violet);
  text("FICTIONAL DEMO / 2026", 436, 760, 7, false, muted);
  line(691);
  text("01", 46, 660, 9, true, violet);
  text("ABOUT ME", 78, 660, 10, true);
  text(
    "I turn complex problems into thoughtful, approachable experiences.",
    78,
    635,
    10,
  );
  text(
    "Curious about the space where design, technology and people meet.",
    78,
    618,
    10,
  );
  line(591);
  text("02", 46, 561, 9, true, violet);
  text("EXPERIENCE", 78, 561, 10, true);
  text("Lumen Studio", 78, 531, 14, true);
  text("2023 - PRESENT", 443, 533, 8, false, muted);
  text("Senior Product Designer", 78, 511, 10, false, muted);
  text(
    "Led the design of a collaborative workspace for creative teams.",
    78,
    485,
    10,
  );
  text(
    "Built a flexible design system with accessible, reusable components.",
    78,
    468,
    10,
  );
  text(
    "Partnered with engineering to turn prototypes into shipped products.",
    78,
    451,
    10,
  );
  text("Northstar Digital", 78, 412, 14, true);
  text("2020 - 2023", 464, 414, 8, false, muted);
  text("Product Designer", 78, 392, 10, false, muted);
  text(
    "Designed intuitive tools that make everyday work a little simpler.",
    78,
    367,
    10,
  );
  text(
    "Worked across research, interaction design and visual storytelling.",
    78,
    350,
    10,
  );
  line(322);
  text("03", 46, 292, 9, true, violet);
  text("SELECTED PROJECT", 78, 292, 10, true);
  text("Bloom / A calmer way to work", 78, 261, 14, true);
  text(
    "An independent exploration of focused, more intentional work.",
    78,
    238,
    10,
  );
  text(
    "Research  /  Product strategy  /  Interaction design  /  Prototyping",
    78,
    218,
    9,
    false,
    muted,
  );
  line(190);
  text("04", 46, 161, 9, true, violet);
  text("EDUCATION & TOOLS", 78, 161, 10, true);
  text("BA in Communication Design", 78, 133, 11, true);
  text("Fictional School of Design, 2020", 78, 115, 9, false, muted);
  text("Figma  /  Framer  /  Design systems  /  Creative coding", 78, 91, 9);
  line(65);
  text(
    "This resume and all work descriptions are fictional demonstration content.",
    46,
    44,
    7,
    false,
    muted,
  );
  text("01 / 01", 516, 44, 7, false, muted);
  await writeFile("public/demo.pdf", await pdf.save());
}
main();
