#!/usr/bin/env python3
"""Deterministic resume extraction via Docling. No LLM involved.

Handles PDF (with automatic local OCR fallback per bitmap region, backed by
the tesseract-ocr system binary) and DOCX. Plain TXT/Markdown never reach
this script — the Node tool passes those through directly. Adapted from
agents/privacy-classifier/agent/sandbox/workspace/scripts/extract_document.py
for the single-document (resume) case.

Usage: extract_resume.py <input_path> <text_output_path> <meta_output_path>
"""
import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 4:
        print(
            "usage: extract_resume.py <input_path> <text_output_path> <meta_output_path>",
            file=sys.stderr,
        )
        return 2

    input_path, text_output_path, meta_output_path = sys.argv[1:4]

    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TesseractCliOcrOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = True
    pipeline_options.ocr_options = TesseractCliOcrOptions(lang=["eng"])

    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        }
    )

    result = converter.convert(input_path)
    # Markdown preserves headings/lists as readable structure, which helps
    # the job-analyst extraction find section boundaries (Experience,
    # Skills, Education) — plain text would flatten them into one blob.
    text = result.document.export_to_markdown()

    Path(text_output_path).write_text(text, encoding="utf-8")

    meta = {
        "status": str(result.status.value),
        "page_count": len(result.pages) if result.pages else None,
        "char_count": len(text),
        "extraction_method": "docling",
        "input_format": Path(input_path).suffix.lstrip(".").lower(),
    }
    Path(meta_output_path).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
