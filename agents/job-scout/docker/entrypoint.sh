#!/bin/sh
# job-scout container entrypoint — named jobs, verbatim pass-through.
# Spec: openspec/changes/container-and-publishing/specs/container-runtime/spec.md
set -e
cd /app

EXPORT_DIR="${EXPORT_DIR:-/app/exports}"

report() {
    newest=$(ls -t "$EXPORT_DIR"/ats_raw_trends_*.parquet 2>/dev/null | head -1)
    if [ -z "$newest" ]; then
        echo "report: no ats_raw_trends_*.parquet in $EXPORT_DIR — run 'export' first" >&2
        exit 1
    fi
    out="$EXPORT_DIR/hiring-trends-$(date -u +%Y%m%d).html"
    python tools/build_trends_report.py --input "$newest" --out "$out"
}

case "$1" in
    load)
        exec python tools/raw_load.py
        ;;
    export)
        exec python tools/raw_load.py --export
        ;;
    report)
        report
        ;;
    trends)
        python tools/raw_load.py
        python tools/raw_load.py --export
        report
        ;;
    match)
        # Paid job: every selected posting hits the jobmatch API.
        # The guard is structural — see the standing "never run the LLM
        # matcher unprompted" rule.
        if [ "$RUN_PAID_MATCH" != "yes" ]; then
            echo "match refused: this calls the paid jobmatch API for every" >&2
            echo "selected posting. Set RUN_PAID_MATCH=yes to confirm."      >&2
            exit 2
        fi
        exec python tools/daily_match.py
        ;;
    *)
        exec "$@"
        ;;
esac
