"""Deterministic resume conversion: PDF/DOCX -> Markdown. No LLM involved.

Usage: python tools/resume_to_md.py <src.pdf|src.docx> [dst.md]
The output feeds the agent system prompt as <candidate_resume> context.
"""
import sys
import logging
from pathlib import Path

log = logging.getLogger("resume_to_md")


def convert(src: Path, dst: Path | None = None) -> Path:
    dst = dst or src.with_suffix(".md")
    if src.suffix.lower() == ".pdf":
        import pymupdf4llm  # deterministic layout-aware extraction
        md = pymupdf4llm.to_markdown(str(src))
    elif src.suffix.lower() == ".docx":
        import mammoth
        with open(src, "rb") as f:
            md = mammoth.convert_to_markdown(f).value
    else:
        raise ValueError(f"Unsupported format: {src.suffix} (use .pdf or .docx)")
    dst.write_text(md, encoding="utf-8")
    log.info("converted %s -> %s (%d chars)", src.name, dst.name, len(md))
    return dst


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    print(convert(src, dst))
