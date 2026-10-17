# HoverCV design system

Reference: https://github.com/VoltAgent/awesome-design-md (MIT), design-md/notion/DESIGN.md and design-md/linear.app/DESIGN.md.
Read from upstream on 2026-10-17. Derived visual direction, not a reproduction of either brand.

A quiet editorial workspace. Warm paper and precise tool chrome, generous document canvas, a restrained violet accent. The PDF is the primary artifact, the controls support it. All UI copy is Chinese; typography uses system sans with Chinese fallbacks. Do not fetch webfonts at runtime.

Tokens: canvas #f6f5f2, paper #fff, sidebar #fbfaf8, ink #292831, muted #77747e, hairline #e8e6e2, violet #6958d5, violet wash #efecfb. Secondary annotation colors #35846b, #ce8a36, #c2647d. 4/8/12/16/24/32/48 spacing. 8px controls, 12px panels, 16px modal radius. Fine borders; shadow reserved for PDF and floating cards. Icons from Lucide, consistent 16px strokes.

Desktop: 224px project rail, flexible dotted canvas, 300px inspector. 68px topbar and compact toolbar. Use a visible hierarchy: eyebrow labels, strong short titles, restrained body copy. No marketing hero above the editor. Empty state explains uploading; a clearly labeled fictional sample makes discovery immediate.

Cards: fixed 360×420 CSS px desktop across all three templates, scroll within. At <=640px use a bottom sheet with max 90vw width and max 70dvh height. Touch targets >=40px, keyboard focus visible, reduced-motion respected. Canvas can scroll horizontally without compressing the PDF. At <=1000px project rail collapses. At <=760px inspector becomes an explicit tab.
