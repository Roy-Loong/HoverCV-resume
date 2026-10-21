// CSS pixels are 1/96 inch; a PDF point is 1/72 inch. Match the web card
// at standard 100% PDF zoom, including its 6:7 width-to-height ratio.
export const HOVER_CARD_WIDTH = 360;
export const HOVER_CARD_HEIGHT = 420;
export const CSS_PIXEL_IN_PDF_POINTS = 72 / 96;
export const PDF_CARD_WIDTH = HOVER_CARD_WIDTH * CSS_PIXEL_IN_PDF_POINTS;
export const PDF_CARD_HEIGHT = HOVER_CARD_HEIGHT * CSS_PIXEL_IN_PDF_POINTS;
