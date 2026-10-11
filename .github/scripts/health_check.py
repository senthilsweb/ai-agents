"""Health check for the endpoints job-pilot depends on.

Costs nothing: only unauthenticated GET /health (or a bare GET for
endpoints without one) — it never calls /analyze, /upload or any LLM.
Endpoint URLs arrive as env vars (GitHub secrets); logs and the email
show only the check *labels*, never the hosts (public repo).

Exit 0 = all up. Exit 1 = at least one down; an HTML alert is emailed
first (SMTP_* + DIGEST_TO/DIGEST_FROM, same secrets as the digest).
With FORCE_EMAIL=1 the email is sent even when everything is up (test).
Without SMTP_HOST the HTML is written to health-report.html instead.
"""
import os
import smtplib
import ssl
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from html import escape

UA = {"User-Agent": "job-pilot-healthcheck/1.0 (+github.com/senthilsweb/ai-agents)"}
ATTEMPTS = 3          # a blip must fail 3 times, 10s apart, to count as down
RETRY_WAIT = int(os.environ.get("RETRY_WAIT", "10"))
TIMEOUT = 15
RAW = "https://raw.githubusercontent.com/senthilsweb/ai-agents/main/agents/job-scout/data/ats_raw_trends.parquet"


@dataclass
class Check:
    label: str
    why: str            # what breaks in job-pilot if this is down
    where: str          # "home lab" / "cloud" — tells you where to look
    url: str | None
    path: str = ""
    # "ok200": must answer 200.  "reachable": any HTTP answer below 500
    # counts (auth-protected collectors reject anonymous GETs with 401/403
    # but that still proves the host is up).
    mode: str = "ok200"
    method: str = "GET"
    ok: bool = False
    detail: str = ""
    ms: int = 0


def probe(c: Check) -> None:
    if not c.url:
        c.detail = "endpoint not configured (secret empty)"
        return
    url = c.url.rstrip("/") + c.path
    for attempt in range(1, ATTEMPTS + 1):
        t0 = time.monotonic()
        try:
            req = urllib.request.Request(url, headers=UA, method=c.method)
            with urllib.request.urlopen(req, timeout=TIMEOUT,
                                        context=ssl.create_default_context()) as r:
                status = r.status
        except urllib.error.HTTPError as e:
            status = e.code
        except Exception as e:                       # DNS, refused, timeout, TLS
            c.ms = int((time.monotonic() - t0) * 1000)
            c.detail = f"{type(e).__name__}: {getattr(e, 'reason', e)}"
            c.ok = False
        else:
            c.ms = int((time.monotonic() - t0) * 1000)
            c.ok = status == 200 if c.mode == "ok200" else status < 500
            c.detail = f"HTTP {status}"
        if c.ok:
            return
        if attempt < ATTEMPTS:
            time.sleep(RETRY_WAIT)
    c.detail += f" (failed {ATTEMPTS} attempts)"


def build_checks(env=os.environ) -> list[Check]:
    return [
        Check("job-matcher API", "/analyze scoring — no matches or cover letters without it",
              "home lab", env.get("JOBMATCH_API_BASE"), "/health"),
        Check("job-matcher agent", "/upload of job descriptions — every match fails without it",
              "home lab", env.get("JOBMATCH_AGENT_BASE"), "/health"),
        Check("Phoenix collector", "trace export (run still succeeds, traces lost)",
              "home lab", env.get("PHOENIX_COLLECTOR_ENDPOINT"), mode="reachable"),
        Check("OTLP endpoint", "trace export (run still succeeds, traces lost)",
              "home lab", env.get("OTEL_EXPORTER_OTLP_ENDPOINT"), mode="reachable"),
        Check("TypeSafe Jev", "Jev gate falls back to the string rules (digest still sends)",
              "cloud", "https://api.typesafe.ai/v1/systemone", mode="reachable"),
        Check("job-scout trends data", "daily delta baseline — parquet fetch from GitHub",
              "cloud", RAW, method="HEAD"),
    ]


def render(checks: list[Check], now: datetime) -> tuple[str, str]:
    down = [c for c in checks if not c.ok]
    subject = (f"job-pilot health: {len(down)} of {len(checks)} DOWN — "
               f"{', '.join(c.label for c in down)}" if down
               else f"job-pilot health: all {len(checks)} checks up (test)")
    rows = []
    for c in checks:
        color, word = ("#0a7d5f", "UP") if c.ok else ("#d03b3b", "DOWN")
        rows.append(f"""
    <div style="background:#fcfcfb; border:1px solid #e1e0d9; border-left:4px solid {color}; border-radius:8px; margin-bottom:10px; padding:12px 16px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse"><tr>
        <td style="font-size:15px; font-weight:700">{escape(c.label)}
          <span style="color:#898781; font-weight:400; font-size:12px"> · {escape(c.where)}</span></td>
        <td align="right"><span style="background:{color}; color:#fff; font-size:11px; font-weight:700; padding:2px 8px; border-radius:10px">{word}</span></td>
      </tr></table>
      <div style="color:#52514e; font-size:12.5px; margin-top:4px">{escape(c.detail)}{f' · {c.ms} ms' if c.ms else ''}</div>
      {'' if c.ok else f'<div style="color:#d03b3b; font-size:12.5px; margin-top:4px"><strong>Impact:</strong> {escape(c.why)}</div>'}
    </div>""")
    html = f"""<!doctype html>
<html><body style="margin:0; padding:0; background:#f9f9f7; color:#0b0b0b; font-family:-apple-system,Segoe UI,Arial,sans-serif">
<div style="max-width:720px; margin:0 auto; padding:24px 16px">
  <h2 style="margin:0 0 2px; font-size:20px">job-pilot health <span style="color:#898781; font-weight:400">· {now:%a %b %d, %H:%M} UTC</span></h2>
  <p style="color:#52514e; font-size:13px; margin:2px 0 18px">
    <strong style="color:{'#d03b3b' if down else '#0a7d5f'}">{len(down)} of {len(checks)} checks down</strong>
    · free health probes only (no OpenAI / no paid calls) · re-checked every 4 hours
  </p>{''.join(rows)}
  <p style="color:#898781; font-size:11.5px; margin-top:16px">Each check retried {ATTEMPTS}× ({RETRY_WAIT}s apart) before counting as down.
  You will get this email every 4 hours until the endpoints recover.</p>
</div></body></html>"""
    return subject, html


def send(subject: str, html: str, env=os.environ) -> None:
    msg = EmailMessage()
    msg["Subject"], msg["From"] = subject, env["DIGEST_FROM"]
    msg["To"] = ", ".join(a.strip() for a in env["DIGEST_TO"].split(",") if a.strip())
    msg.set_content("job-pilot health alert — view in an HTML-capable mail client.")
    msg.add_alternative(html, subtype="html")
    with smtplib.SMTP(env["SMTP_HOST"], int(env.get("SMTP_PORT", "587")), timeout=60) as s:
        s.starttls(context=ssl.create_default_context())
        s.login(env["SMTP_USER"], env["SMTP_PASS"])
        s.send_message(msg)


def main() -> int:
    checks = build_checks()
    for c in checks:
        probe(c)
        print(f"{'UP  ' if c.ok else 'DOWN'} {c.label}: {c.detail} {c.ms}ms")
    down = [c for c in checks if not c.ok]
    if down or os.environ.get("FORCE_EMAIL") == "1":
        subject, html = render(checks, datetime.now(timezone.utc))
        if os.environ.get("SMTP_HOST"):
            send(subject, html)
            print("alert email sent")
        else:
            open("health-report.html", "w").write(html)
            print("no SMTP_HOST — wrote health-report.html")
    return 1 if down else 0


if __name__ == "__main__":
    sys.exit(main())
