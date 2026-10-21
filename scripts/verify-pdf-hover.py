"""Exercise exported PDF form actions in PDFium (optional maintainer check).

Requires: pip install pypdfium2 pypdf
Usage: python scripts/verify-pdf-hover.py FILE.pdf [--snapshots PRIVATE_DIR]
This checks native PDF events, not a replacement web viewer or WeChat.
PDFium's bare form-event API also dispatches input to hidden source widgets.
Covered-source body clicks are reported as unverified, not counted as passes.
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
        def focused_name():
            page_number=ctypes.c_int(-1)
            focused=pdfium.raw.FPDF_ANNOTATION()
            found=pdfium.raw.FORM_GetFocusedAnnot(doc.formenv,ctypes.byref(page_number),ctypes.byref(focused))
            if not found or not focused:return ""
            try:
                length=pdfium.raw.FPDFAnnot_GetStringValue(focused,b"T",None,0)
                buffer=(ctypes.c_ushort*((length+1)//2))()
                pdfium.raw.FPDFAnnot_GetStringValue(focused,b"T",buffer,length)
                return bytes(buffer)[:length].decode("utf-16-le").rstrip("\0")
            finally:pdfium.raw.FPDFPage_CloseAnnot(focused)
        assert not visible_panels(), "Cards must start hidden"
        snapshot("idle")
        for ordinal, (group, hits) in enumerate(groups.items()):
            _, hit = hits[0]
            panels = [name for name in by_name if name.startswith(group+"_h_panel_")]
            expected = group+"_h_panel_0"
            pdfium.raw.FORM_OnMouseMove(doc.formenv, page, 0, 2, 2)
            move(hit)
            assert visible_panels() == [expected], f"MouseEnter failed for fragment {ordinal+1}: {visible_panels()}"
            report["hover"] += 1
            snapshot(f"fragment-{ordinal+1}-hover")
            # This host has no Acrobat JavaScript/timers. MouseExit must still
            # close natively instead of leaving the card stuck open.
            pdfium.raw.FORM_OnMouseMove(doc.formenv, page, 0, 2, 2)
            assert not visible_panels(), "Native MouseExit fallback did not close"
            report["native_exit"] = report.get("native_exit", 0)+1
            # In readers without JavaScript/timers, hover closes immediately.
            # Click the word to pin its card before navigating its controls.
            for mode in ["t"]:
                pdfium.raw.FORM_OnMouseMove(doc.formenv, page, 0, 2, 2)
                if mode=="t":
                    click(hit)
                    pdfium.raw.FORM_OnMouseMove(doc.formenv, page, 0, 2, 2)
                    assert visible_panels() == [group+"_t_panel_0"], "Tap must stay open after pointer exit"
                    report["tap"] = report.get("tap", 0)+1
                    keepers=[a for name,(_,a) in by_name.items() if name.startswith(group+"_t_0_keep_")]
                    card_rect=by_name[group+"_t_panel_0"][1]["/Rect"]
                    for keeper in keepers:
                        # The narrow pointer bridge lies outside the card and
                        # may overlap a source word's reader-expanded hit area.
                        kr=keeper["/Rect"]
                        if kr[0]<card_rect[0] or kr[1]<card_rect[1] or kr[2]>card_rect[2] or kr[3]>card_rect[3]:continue
                        assert int(keeper["/Ff"])&1, "Transparent hover areas must be read-only"
                        assert list(keeper["/Border"])==[0,0,0], "Transparent hover area has a border"
                        # FORM_OnMouseMove in the bare PDFium host dispatches
                        # Enter even to widgets with F=Hidden (also reproducible
                        # with a single initially hidden button). A full reader
                        # must filter those inputs. Do not mistake that host
                        # limitation for verified WPS/Acrobat overlap handling.
                        px,py=point(keeper)
                        covered=[]
                        for other_group,other_hits in groups.items():
                            if other_group==group:continue
                            for index,other in other_hits:
                                hr=other["/Rect"]
                                if hr[0]<=px<=hr[2] and hr[1]<=py<=hr[3]:
                                    native=pdfium.raw.FPDFPage_GetAnnot(page,index)
                                    flags=pdfium.raw.FPDFAnnot_GetFlags(native)
                                    pdfium.raw.FPDFPage_CloseAnnot(native)
                                    assert flags&pdfium.raw.FPDF_ANNOT_FLAG_HIDDEN, "Pinned card left a covered source widget visible"
                                    covered.append(other)
                        if covered:
                            report["hidden_input_cases_unverified"]=report.get("hidden_input_cases_unverified",0)+1
                            continue
                        click(keeper)
                        assert "_keep_" not in focused_name(), "Clicking the card body focused a large invisible field"
                        assert visible_panels() == [group+"_t_panel_0"], f"Read-only body region {keeper['/T']} lost card: {visible_panels()}"
                        report["body_without_focus"] = report.get("body_without_focus",0)+1
                else:move(hit)
                for frame in range(1, len(panels)):
                    click(by_name[f"{group}_{mode}_{frame-1}_next"][1])
                    assert visible_panels() == [f"{group}_{mode}_panel_{frame}"], f"Next did not switch {mode} card {ordinal+1}: {visible_panels()}"
                    report["next"] += 1
                    snapshot(f"fragment-{ordinal+1}-{mode}-frame-{frame+1}")
                for frame in reversed(range(1, len(panels))):
                    click(by_name[f"{group}_{mode}_{frame}_prev"][1])
                    assert visible_panels() == [f"{group}_{mode}_panel_{frame-1}"], f"Previous did not restore {mode} card {ordinal+1}: {visible_panels()}"
                    report["previous"] += 1
                click(by_name[f"{group}_{mode}_0_close"][1])
                assert not visible_panels(), f"Close button did not hide {mode} card"
                report["close"] += 1
            pdfium.raw.FORM_OnMouseMove(doc.formenv, page, 0, 2, 2)
            move(hit)
            assert visible_panels() == [expected], "Card could not reopen after closing"
            report["reopen"] += 1
            click(by_name[group+"_h_0_close"][1])
            assert not visible_panels()
            report["anchors"] += 1
            report["notes"] += 1
            report["frames"] += len(panels)
        page.close()
finally:
    doc.close()
assert report["notes"] > 0, "No HoverCV native hover fields were tested"
print(json.dumps(report))
