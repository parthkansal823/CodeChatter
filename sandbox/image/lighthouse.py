"""Lighthouse in a room's sandbox (apps/runner/src/lighthouse.ts): Google's own, with the image's Chromium, against a server running here, on localhost,
as the room's browser shows it. Performance (on a phone, throttled, or a desktop), accessibility, best practices and SEO: each category's score, the
page's Core Web Vitals, and what failed, in a summary for the room; and Lighthouse's own HTML report, whole."""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

LIGHTHOUSE = "/usr/local/lib/codechatter/lighthouse/node_modules/lighthouse/cli/index.js"
CHROME = "/usr/bin/chromium"
CATEGORIES = ("performance", "accessibility", "best-practices", "seo")
METRICS = ("first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index", "interactive")
MOST_FAILING = 30
PATH = re.compile(r"^/[^\s]{0,1999}$")
LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")


class Refused(Exception):
    """Something the person should be told."""


def plain(text):
    """Lighthouse's Markdown links, as their words."""
    return LINK.sub(r"\1", str(text or "")).strip()


def summary(report, categories, device):
    audits = report.get("audits") or {}
    shown = []
    for name in categories:
        category = (report.get("categories") or {}).get(name)
        if not category:
            continue
        failing = []
        for ref in category.get("auditRefs") or []:
            audit = audits.get(ref.get("id"))
            if not audit or audit.get("scoreDisplayMode") in ("notApplicable", "manual", "informative"):
                continue
            score = audit.get("score")
            if score is None or score >= 0.9:
                continue
            failing.append({"id": audit.get("id"), "title": plain(audit.get("title")), "description": plain(audit.get("description"))[:600], "displayValue": audit.get("displayValue"), "score": score, "weight": ref.get("weight", 0), "group": ref.get("group")})
        # What counts most, then what's worst.
        failing.sort(key=lambda item: (-(item["weight"] or 0), item["score"]))
        score = category.get("score")
        shown.append({"id": name, "title": category.get("title"), "score": None if score is None else round(score * 100), "failing": failing[:MOST_FAILING]})
    metrics = []
    for name in METRICS:
        audit = audits.get(name)
        if audit:
            metrics.append({"id": name, "title": plain(audit.get("title")), "displayValue": audit.get("displayValue"), "score": audit.get("score")})
    return {
        "url": report.get("finalDisplayedUrl") or report.get("requestedUrl"),
        "device": device,
        "fetchedAt": report.get("fetchTime"),
        "lighthouseVersion": report.get("lighthouseVersion"),
        "categories": shown,
        "metrics": metrics,
        "warnings": [plain(warning) for warning in (report.get("runWarnings") or [])][:5],
    }


def run(request):
    port = request.get("port")
    path = request.get("path") or "/"
    if not isinstance(port, int) or not 1 <= port <= 65535:
        raise Refused("That isn't a port.")
    if not isinstance(path, str) or not PATH.match(path):
        raise Refused("That isn't a path on the server.")
    device = "desktop" if request.get("device") == "desktop" else "mobile"
    wanted = request.get("categories") if isinstance(request.get("categories"), list) else list(CATEGORIES)
    categories = [name for name in CATEGORIES if name in wanted] or list(CATEGORIES)
    if not os.path.exists(LIGHTHOUSE) or not os.path.exists(CHROME):
        raise Refused("This room's sandbox doesn't have Lighthouse yet. Restarting the sandbox brings it up to date.")
    work = tempfile.mkdtemp(prefix="cc-lighthouse-")
    try:
        args = [
            "node", LIGHTHOUSE, f"http://localhost:{port}{path}",
            "--output=json", "--output=html", f"--output-path={work}/report",
            "--quiet", "--max-wait-for-load=45000",
            "--chrome-flags=--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --no-default-browser-check",
            f"--only-categories={','.join(categories)}",
        ]
        if device == "desktop":
            args.append("--preset=desktop")
        env = {**os.environ, "CHROME_PATH": CHROME, "HOME": work}
        try:
            done = subprocess.run(args, capture_output=True, text=True, timeout=150, env=env, cwd=work)
        except subprocess.TimeoutExpired:
            raise Refused("Lighthouse took more than two and a half minutes, so it was stopped.")
        found = os.path.join(work, "report.report.json")
        if not os.path.exists(found):
            lines = [line for line in (done.stderr or "").splitlines() if line.strip()]
            raise Refused(f"Lighthouse didn't finish: {lines[-1][:300] if lines else 'it gave no reason'}.")
        with open(found, encoding="utf-8") as handle:
            report = json.load(handle)
        problem = report.get("runtimeError")
        if isinstance(problem, dict) and problem.get("message"):
            raise Refused(f"Lighthouse couldn't load the page: {plain(problem['message'])[:300]}")
        page = os.path.join(work, "report.report.html")
        html = None
        if os.path.exists(page):
            with open(page, encoding="utf-8") as handle:
                html = handle.read()
        return {**summary(report, categories, device), "html": html}
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    try:
        print(json.dumps(run(json.load(sys.stdin))))
    except Refused as error:
        print(json.dumps({"error": str(error)}))
