#!/usr/bin/env python3
"""Deterministic, non-generative PII/NPI detection via Microsoft Presidio.

No LLM, no network call — statistical/NER-based recognizers only. Runs once
against the full extracted text (Presidio has no meaningful context-window
limit, unlike a GenAI model, so it does not need chunking).

Usage: presidio_analyze.py <text_input_path> <json_output_path> [language] [score_threshold]
"""
import json
import sys
from pathlib import Path


def build_analyzer(language: str):
    from presidio_analyzer import AnalyzerEngine
    from presidio_analyzer.nlp_engine import NlpEngineProvider

    model_name = "en_core_web_sm" if language == "en" else f"{language}_core_news_sm"
    provider = NlpEngineProvider(
        nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": language, "model_name": model_name}],
        }
    )
    nlp_engine = provider.create_engine()
    return AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=[language])


def main() -> int:
    if len(sys.argv) < 3:
        print(
            "usage: presidio_analyze.py <text_input_path> <json_output_path> [language] [score_threshold]",
            file=sys.stderr,
        )
        return 2

    text_input_path, json_output_path = sys.argv[1:3]
    language = sys.argv[3] if len(sys.argv) > 3 else "en"
    score_threshold = float(sys.argv[4]) if len(sys.argv) > 4 else 0.4

    text = Path(text_input_path).read_text(encoding="utf-8")
    analyzer = build_analyzer(language)
    results = analyzer.analyze(text=text, language=language, score_threshold=score_threshold)

    findings = [
        {
            "entity_type": r.entity_type,
            "start": r.start,
            "end": r.end,
            "score": r.score,
            "text_excerpt": text[r.start : r.end][:200],
        }
        for r in results
    ]

    Path(json_output_path).write_text(
        json.dumps({"findings": findings}, indent=2), encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
