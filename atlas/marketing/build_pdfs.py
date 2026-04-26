#!/usr/bin/env python3
"""Convert Atlas marketing markdown files to PDF using ReportLab."""
import os
import re
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, black
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Preformatted, KeepTogether
)

ROOT = Path(__file__).resolve().parent
SRC_FILES = [
    ROOT / "copy" / "landing-page.md",
    ROOT / "copy" / "email-sequences.md",
    ROOT / "copy" / "social-media.md",
    ROOT / "copy" / "ad-copy.md",
    ROOT / "prompts" / "claude-prompts.md",
    ROOT / "scripts" / "sales-scripts.md",
    ROOT / "scripts" / "video-scripts.md",
]
OUT_DIR = ROOT / "pdfs"
OUT_DIR.mkdir(exist_ok=True)

ACCENT = HexColor("#4f8fff")
MUTED = HexColor("#607090")
BG_CODE = HexColor("#f3f4f8")

styles = getSampleStyleSheet()

H1 = ParagraphStyle("H1", parent=styles["Heading1"], fontName="Helvetica-Bold",
                   fontSize=22, leading=28, textColor=black, spaceBefore=10, spaceAfter=12)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName="Helvetica-Bold",
                   fontSize=15, leading=20, textColor=ACCENT, spaceBefore=14, spaceAfter=8)
H3 = ParagraphStyle("H3", parent=styles["Heading3"], fontName="Helvetica-Bold",
                   fontSize=12, leading=16, textColor=black, spaceBefore=10, spaceAfter=6)
H4 = ParagraphStyle("H4", parent=styles["Heading4"], fontName="Helvetica-Bold",
                   fontSize=11, leading=14, textColor=MUTED, spaceBefore=8, spaceAfter=4)
BODY = ParagraphStyle("Body", parent=styles["BodyText"], fontName="Helvetica",
                     fontSize=10, leading=14, textColor=black, spaceAfter=6, alignment=TA_LEFT)
BULLET = ParagraphStyle("Bullet", parent=BODY, leftIndent=18, bulletIndent=6, spaceAfter=3)
QUOTE = ParagraphStyle("Quote", parent=BODY, leftIndent=18, rightIndent=18,
                      textColor=MUTED, fontName="Helvetica-Oblique", spaceAfter=6)
CODE = ParagraphStyle("Code", parent=styles["Code"], fontName="Courier",
                     fontSize=8, leading=11, textColor=black, leftIndent=10,
                     backColor=BG_CODE, borderPadding=6, spaceAfter=8)

def escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def inline(s: str) -> str:
    s = escape(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<i>\1</i>", s)
    s = re.sub(r"`([^`]+)`", r'<font face="Courier" size="9">\1</font>', s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<link href="\2" color="#4f8fff">\1</link>', s)
    return s

def md_to_flowables(md_text: str):
    lines = md_text.split("\n")
    out = []
    i = 0
    in_code = False
    code_buf = []
    in_table = False
    table_buf = []

    while i < len(lines):
        line = lines[i]

        if line.startswith("```"):
            if in_code:
                if code_buf:
                    out.append(Preformatted("\n".join(code_buf), CODE))
                code_buf = []
                in_code = False
            else:
                in_code = True
            i += 1
            continue
        if in_code:
            code_buf.append(line)
            i += 1
            continue

        if line.startswith("|") and "|" in line[1:]:
            table_buf.append(line)
            in_table = True
            i += 1
            continue
        elif in_table:
            for trow in table_buf:
                cells = [c.strip() for c in trow.strip().strip("|").split("|")]
                if all(re.match(r"^:?-+:?$", c) for c in cells if c):
                    continue
                row_text = "  •  ".join(cells)
                out.append(Paragraph(inline(row_text), BODY))
            table_buf = []
            in_table = False

        if not line.strip():
            out.append(Spacer(1, 4))
            i += 1
            continue

        if line.startswith("# "):
            out.append(Paragraph(inline(line[2:]), H1))
        elif line.startswith("## "):
            out.append(Paragraph(inline(line[3:]), H2))
        elif line.startswith("### "):
            out.append(Paragraph(inline(line[4:]), H3))
        elif line.startswith("#### "):
            out.append(Paragraph(inline(line[5:]), H4))
        elif re.match(r"^---+\s*$", line):
            out.append(Spacer(1, 6))
        elif line.startswith("> "):
            out.append(Paragraph(inline(line[2:]), QUOTE))
        elif re.match(r"^\s*[-*]\s+", line):
            content = re.sub(r"^\s*[-*]\s+", "", line)
            out.append(Paragraph(inline(content), BULLET, bulletText="•"))
        elif re.match(r"^\s*\d+\.\s+", line):
            content = re.sub(r"^\s*\d+\.\s+", "", line)
            num = re.match(r"^\s*(\d+)\.", line).group(1)
            out.append(Paragraph(inline(content), BULLET, bulletText=f"{num}."))
        else:
            out.append(Paragraph(inline(line), BODY))
        i += 1

    if in_table and table_buf:
        for trow in table_buf:
            cells = [c.strip() for c in trow.strip().strip("|").split("|")]
            if all(re.match(r"^:?-+:?$", c) for c in cells if c):
                continue
            row_text = "  •  ".join(cells)
            out.append(Paragraph(inline(row_text), BODY))

    return out

def add_header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(0.75*inch, 0.5*inch, "Atlas Analysis · Marketing")
    canvas.drawRightString(letter[0]-0.75*inch, 0.5*inch, f"Page {doc.page}")
    canvas.restoreState()

def convert(src: Path):
    out = OUT_DIR / (src.stem + ".pdf")
    md = src.read_text(encoding="utf-8")
    doc = SimpleDocTemplate(str(out), pagesize=letter,
                            leftMargin=0.75*inch, rightMargin=0.75*inch,
                            topMargin=0.75*inch, bottomMargin=0.75*inch,
                            title=src.stem.replace("-", " ").title(),
                            author="Atlas Analysis")
    flow = md_to_flowables(md)
    doc.build(flow, onFirstPage=add_header_footer, onLaterPages=add_header_footer)
    print(f"  -> {out.relative_to(ROOT.parent)}  ({out.stat().st_size:,} bytes)")

if __name__ == "__main__":
    print("Generating Atlas marketing PDFs:")
    for f in SRC_FILES:
        if not f.exists():
            print(f"  ! missing: {f}")
            continue
        convert(f)
    print(f"\nDone. {len(list(OUT_DIR.glob('*.pdf')))} PDFs in {OUT_DIR.relative_to(ROOT.parent)}")
