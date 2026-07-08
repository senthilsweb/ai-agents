#!/usr/bin/env python3
"""Deterministic document extraction via Docling. No LLM involved.

Handles PDF (with automatic local OCR fallback per bitmap region, backed by
the tesseract-ocr system binary), DOCX, HTML, and images through one
converter. Plain TXT/Markdown never reach this script — the Node tool passes
those through directly.

Usage: extract_document.py <input_path> <text_output_path> <meta_output_path>
"""
import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 4:
        print(
            "usage: extract_document.py <input_path> <text_output_path> <meta_output_path>",
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
    # Markdown preserves headings/lists/tables as readable structure, which
    # helps both the GenAI detector and Presidio's NER context — plain text
    # would flatten tables into a much harder-to-parse blob.
    text = result.document.export_to_markdown()

    Path(text_output_path).write_text(text, encoding="utf-8")

    meta = {
        "status": str(result.status.value),
        "page_count": len(result.pages) if result.pages else None,
        "char_count": len(text),
        "ocr_enabled": True,
        "extraction_method": "docling",
        "input_format": Path(input_path).suffix.lstrip(".").lower(),
    }
    Path(meta_output_path).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
