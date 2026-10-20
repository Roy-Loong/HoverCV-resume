"""Exercise exported PDF form actions in PDFium (optional maintainer check).

Requires: pip install pypdfium2 pypdf
Usage: python scripts/verify-pdf-hover.py FILE.pdf [--snapshots PRIVATE_DIR]
This checks native PDF events, not a replacement web viewer or WeChat.
"""
import argparse
import ctypes
import json
import re
from pathlib import Path

import pypdfium2 as pdfium
from pypdf import PdfReader

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("pdf", type=Path)
parser.add_argument("--snapshots", type=Path)
args = parser.parse_args()
reader = PdfReader(args.pdf)
if args.snapshots:
    args.snapshots.mkdir(parents=True, exist_ok=True)
report = {"pages": len(reader.pages), "notes": 0, "anchors": 0, "frames": 0, "hover": 0, "next": 0, "previous": 0, "close": 0, "reopen": 0}
doc = pdfium.PdfDocument(args.pdf)
doc.init_forms()
try:
    for page_index, source in enumerate(reader.pages):
        page = doc[page_index]
        annotations = [(index, ref.get_object()) for index, ref in enumerate(source.get("/Annots", []))]
        by_name = {str(a.get("/T", "")): (index, a) for index, a in annotations}
        groups = {}
        for name, record in by_name.items():
            match = re.fullmatch(r"(HC[^_]+_\d+)_hover_\d+", name)
            if match:
                groups.setdefault(match.group(1), []).append(record)
        def visible_panels():
            visible = []
            for index, a in annotations:
                name = str(a.get("/T", ""))
                if "_panel_" not in name or not name.startswith("HC"):
                    continue
                annot = pdfium.raw.FPDFPage_GetAnnot(page, index)
                flags = pdfium.raw.FPDFAnnot_GetFlags(annot)
                pdfium.raw.FPDFPage_CloseAnnot(annot)
                if not flags & pdfium.raw.FPDF_ANNOT_FLAG_HIDDEN:
                    visible.append(name)
            return visible
        def point(a):
            r = a["/Rect"]
            return float((r[0]+r[2])/2), float((r[1]+r[3])/2)
        def move(a):
            x, y = point(a)
            pdfium.raw.FORM_OnMouseMove(doc.formenv, page, 0, x, y)
        def click(a):
            # The minimal PDFium host has no UI focus manager. Release a
            # focused widget hidden by the previous Hide action before the
            # next input, as a reader host must do when its target disappears.
            page_number=ctypes.c_int(-1)
            focused=pdfium.raw.FPDF_ANNOTATION()
            if pdfium.raw.FORM_GetFocusedAnnot(doc.formenv,ctypes.byref(page_number),ctypes.byref(focused)) and focused:
                hidden=pdfium.raw.FPDFAnnot_GetFlags(focused)&pdfium.raw.FPDF_ANNOT_FLAG_HIDDEN
                pdfium.raw.FPDFPage_CloseAnnot(focused)
                if hidden:pdfium.raw.FORM_ForceToKillFocus(doc.formenv)
            move(a)
            x, y = point(a)
            pdfium.raw.FORM_OnLButtonDown(doc.formenv, page, 0, x, y)
            pdfium.raw.FORM_OnLButtonUp(doc.formenv, page, 0, x, y)
        def snapshot(label):
            if args.snapshots:
                page.render(scale=1.5, may_draw_forms=True).to_pil().save(args.snapshots / f"page-{page_index+1}-{label}.png")
        assert not visible_panels(), "Cards must start hidden"
        snapshot("idle")
        for ordinal, (group, hits) in enumerate(groups.items()):
            _, hit = hits[0]
            panels = [name for name in by_name if name.startswith(group+"_panel_")]
            expected = group+"_panel_0"
            pdfium.raw.FORM_OnMouseMove(doc.formenv, page, 0, 2, 2)
            move(hit)
            assert visible_panels() == [expected], f"MouseEnter failed for note {ordinal+1}: {visible_panels()}"
            report["hover"] += 1
            snapshot(f"note-{ordinal+1}-hover")
            for frame in range(1, len(panels)):
                click(by_name[f"{group}_{frame-1}_next"][1])
                assert visible_panels() == [f"{group}_panel_{frame}"], "Next did not switch the visible card"
                report["next"] += 1
                snapshot(f"note-{ordinal+1}-frame-{frame+1}")
            for frame in reversed(range(1, len(panels))):
                click(by_name[f"{group}_{frame}_prev"][1])
                assert visible_panels() == [f"{group}_panel_{frame-1}"], "Previous did not restore the prior card"
                report["previous"] += 1
            click(by_name[group+"_close"][1])
            assert visible_panels() == [], "Close button did not hide the card"
            report["close"] += 1
            pdfium.raw.FORM_OnMouseMove(doc.formenv, page, 0, 2, 2)
            move(hit)
            assert visible_panels() == [expected], "Card could not reopen after closing"
            report["reopen"] += 1
            click(by_name[group+"_close"][1])
            assert not visible_panels()
            report["anchors"] += 1
            for _, other_hit in hits[1:]:
                pdfium.raw.FORM_OnMouseMove(doc.formenv, page, 0, 2, 2)
                move(other_hit)
                assert visible_panels() == [expected], "One text fragment did not open its card"
                click(by_name[group+"_close"][1])
                assert not visible_panels()
                report["anchors"] += 1
            report["notes"] += 1
            report["frames"] += len(panels)
        page.close()
finally:
    doc.close()
assert report["notes"] > 0, "No HoverCV native hover fields were tested"
print(json.dumps(report))
