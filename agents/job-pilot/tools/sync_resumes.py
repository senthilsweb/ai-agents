"""Sync the owner's resume DOCX files into inputs/resumes/, scrubbed.

    python tools/sync_resumes.py <resume-variant>/references/master

Copies sk-resume-{master,genai-fde,data-genai-fde,eng-manager}-*.docx
from the owner's private resume-variant folder. This repo is public, so
the one phone number in each file's body is replaced by {{PHONE}}
(pipeline/resumes.py puts the real one back from LETTERHEAD_PHONE when
an email attachment is rendered). The tool refuses to write a file if it
cannot find exactly one phone number, or if anything phone-shaped
remains in any part of the DOCX. Older files for a key are removed, so
inputs/resumes/ always holds exactly one file per variant.
"""
import io
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline.resumes import KEYS, PHONE_PLACEHOLDER, PHONE_RE  # noqa: E402


def scrub(src: Path) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(src) as zin, \
            zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename == "word/document.xml":
                text = data.decode("utf-8")
                found = PHONE_RE.findall(text)
                if len(found) != 1:
                    raise SystemExit(f"{src.name}: expected exactly one phone "
                                     f"number in the body, found {len(found)}")
                data = PHONE_RE.sub(PHONE_PLACEHOLDER, text).encode("utf-8")
            zout.writestr(info, data)
    with zipfile.ZipFile(io.BytesIO(out.getvalue())) as check:
        for name in check.namelist():
            if PHONE_RE.search(check.read(name).decode("utf-8", "ignore")):
                raise SystemExit(f"{src.name}: phone-shaped text left in {name}")
    return out.getvalue()


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    src_dir = Path(argv[1]).expanduser()
    dest_dir = ROOT / "inputs" / "resumes"
    dest_dir.mkdir(parents=True, exist_ok=True)
    plan = []
    for key in KEYS:
        hits = sorted(src_dir.glob(f"sk-resume-{key}-*.docx"))
        if len(hits) != 1:
            raise SystemExit(f"{src_dir}: expected exactly one "
                             f"sk-resume-{key}-*.docx, found {len(hits)}")
        plan.append((key, hits[0], scrub(hits[0])))
    for key, src, data in plan:          # all scrubbed OK — now write
        for old in dest_dir.glob(f"sk-resume-{key}-*.docx"):
            old.unlink()
        (dest_dir / src.name).write_bytes(data)
        print(f"{key:15} -> inputs/resumes/{src.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
