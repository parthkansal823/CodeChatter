"""
LaTeX in a room (apps/runner/src/latex.ts runs this inside the sandbox): real TeX Live through latexmk, which runs pdflatex and biber or bibtex as
many times as a paper needs. What it makes goes in ~/paper rather than the room's files, so building doesn't add files to the room, and everyone in
the room reads the same result. The last good PDF stays when a build fails, so a typo doesn't take the paper away while it's being fixed.

Takes {"op", "file", "fresh"} on stdin, and prints one JSON object.
"""
import base64
import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time

WORKSPACE = "/workspace"
PAPER = os.path.expanduser("~/paper")
BUILD_SECONDS = 100
MOST_PDF_BYTES = 12 * 1024 * 1024
MOST_PROBLEMS = 100
MOST_LOG_CHARS = 20_000
MOST_FOLDERS = 2000
KEEP_FRESH = {"lock", "result.json"}

FILE_LINE = re.compile(r"^(?P<file>[^\s:()][^:()\n]*):(?P<line>\d+): (?P<message>.+)$", re.M)
PLAIN_ERROR = re.compile(r"^! (?P<message>.+)$", re.M)
WARNING = re.compile(r"^(?:LaTeX|Package [\w.-]+|Class [\w.-]+) Warning: (?P<message>.+?)(?: on input line (?P<line>\d+))?\.?$", re.M)
# What comes after the real error, and says nothing more about it.
AFTERMATH = {"Emergency stop.", "==> Fatal error occurred, no output PDF file produced!"}
SOURCE_LINE = re.compile(r"^l\.\d+ ?(.*)$", re.M)
OVERFULL = re.compile(r"^(?:Overfull|Underfull) \\[hv]box", re.M)
OUTPUT = re.compile(r"Output written on .*?\((\d+) pages?, (\d+) bytes\)")
BIBER = re.compile(r"^\[\d+\] \S+> (?P<level>ERROR|WARN) - (?P<message>.+)$", re.M)
BIB_PLACE = re.compile(r"([^\s/,]+\.bib)[^,\s]*, line (\d+)")
BIBTEX_PLACE = re.compile(r"^(?P<message>.+?)---line (?P<line>\d+) of file (?P<file>\S+)$", re.M)


class Refused(Exception):
    """Something the person should be told."""


def source(file):
    """Where a file is, as long as it's a .tex file in the room: this comes from a request."""
    path = os.path.realpath(os.path.join(WORKSPACE, str(file)))
    if not path.startswith(WORKSPACE + os.sep) or not path.lower().endswith(".tex") or not os.path.isfile(path):
        raise Refused(f"There's no file called {file}.")
    return path


def folder_of(file):
    return os.path.join(PAPER, hashlib.sha256(str(file).encode("utf-8")).hexdigest()[:16])


def in_room(path, folder):
    full = os.path.normpath(os.path.join(folder, path))
    return os.path.relpath(full, WORKSPACE).replace(os.sep, "/") if full.startswith(WORKSPACE + os.sep) else None


def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as file:
            return file.read()
    except OSError:
        return ""


def only_tex_read(out, stem, folder):
    """The one .tex file a build read, if it read just one: TeX's warnings say which line, but not of which file."""
    found = set()
    for line in read(os.path.join(out, f"{stem}.fls")).splitlines():
        if line.startswith("INPUT ") and line.lower().endswith(".tex"):
            found.add(in_room(line[6:], folder))
    found.discard(None)
    return next(iter(found)) if len(found) == 1 else None


def problems_in(log, blg, folder, single):
    problems = []
    seen = set()

    def add(severity, file, line, message, context=None):
        key = (severity, file, line, message)
        if key in seen or len(problems) >= MOST_PROBLEMS:
            return
        seen.add(key)
        problems.append({"severity": severity, "file": file, "line": line, "message": message.strip()[:500], "context": context})

    # In the order TeX met them, as the first is usually the cause of the rest.
    errors = []
    for match in FILE_LINE.finditer(log):
        file = in_room(match["file"], folder)
        after = SOURCE_LINE.search(log, match.end(), match.end() + 800)
        errors.append((match.start(), file, int(match["line"]) if file else None, match["message"], after[1].strip()[:200] if after else None))
    for match in PLAIN_ERROR.finditer(log):
        errors.append((match.start(), None, None, match["message"], None))
    errors.sort(key=lambda item: item[0])
    for index, (_, file, line, message, context) in enumerate(errors):
        if message.strip() in AFTERMATH and len(errors) > 1:
            continue
        # An error TeX gives no place for, like a missing package, happened where TeX stopped next.
        if not file and index + 1 < len(errors) and errors[index + 1][3].strip() in AFTERMATH:
            _, file, line, _, context = errors[index + 1]
        add("error", file, line, message, context)
    for match in BIBER.finditer(blg):
        place = BIB_PLACE.search(match["message"])
        file = in_room(place[1], folder) if place and os.path.exists(os.path.join(folder, place[1])) else None
        add("error" if match["level"] == "ERROR" else "warning", file, int(place[2]) if file else None, match["message"])
    for match in BIBTEX_PLACE.finditer(blg):
        add("error", in_room(match["file"], folder), int(match["line"]), match["message"])
    for match in WARNING.finditer(log):
        line = match["line"]
        add("warning", single if line else None, int(line) if line and single else None, match["message"])
    problems.sort(key=lambda item: item["severity"] != "error")
    return problems


def mirror_folders(folder, out):
    """\\include{chapters/one} writes chapters/one.aux beside the rest of what's made, and TeX won't make that folder itself."""
    made = 0
    for current, names, _ in os.walk(folder):
        names[:] = [name for name in names if not name.startswith(".") and name != "node_modules"]
        for name in names:
            os.makedirs(os.path.join(out, os.path.relpath(os.path.join(current, name), folder)), exist_ok=True)
            made += 1
            if made >= MOST_FOLDERS:
                return


def run_latexmk(name, folder, out):
    environment = {**os.environ, "max_print_line": "2000", "error_line": "254", "half_error_line": "238"}
    # -f goes on past an error: most still give a PDF, as other LaTeX editors show one.
    command = ["latexmk", "-pdf", "-f", "-interaction=nonstopmode", "-file-line-error", f"-outdir={out}", f"./{name}"]
    process = subprocess.Popen(command, cwd=folder, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", start_new_session=True)
    try:
        output, _ = process.communicate(timeout=BUILD_SECONDS)
        return output, False
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        output, _ = process.communicate()
        return output, True


def build(file, fresh):
    path = source(file)
    out = folder_of(file)
    os.makedirs(out, exist_ok=True)
    folder = os.path.dirname(path)
    name = os.path.basename(path)
    stem = os.path.splitext(name)[0]
    pdf = os.path.join(out, f"{stem}.pdf")
    # One at a time: a second person's build waits its turn rather than treading on this one's files.
    with open(os.path.join(out, "lock"), "w", encoding="utf-8") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        started = time.time()
        if fresh:
            for item in os.listdir(out):
                if item not in KEEP_FRESH:
                    target = os.path.join(out, item)
                    shutil.rmtree(target) if os.path.isdir(target) else os.unlink(target)
        mirror_folders(folder, out)
        output, timed_out = run_latexmk(name, folder, out)
        log = read(os.path.join(out, f"{stem}.log"))
        problems = problems_in(log, read(os.path.join(out, f"{stem}.blg")), folder, only_tex_read(out, stem, folder))
        if timed_out:
            problems.insert(0, {"severity": "error", "file": None, "line": None, "message": f"It was still building after {BUILD_SECONDS} seconds, so it was stopped.", "context": None})
        made = OUTPUT.search(log)
        has_pdf = os.path.exists(pdf)
        ok = has_pdf and os.path.getmtime(pdf) >= started - 1 and not any(item["severity"] == "error" for item in problems)
        if not ok and not any(item["severity"] == "error" for item in problems):
            problems.insert(0, {"severity": "error", "file": None, "line": None, "message": "It didn't make a PDF. What LaTeX said is in the log.", "context": None})
        result = {
            "file": file,
            "built": True,
            "ok": ok,
            "at": int(time.time() * 1000),
            "ms": int((time.time() - started) * 1000),
            "pages": int(made[1]) if made else None,
            "bytes": os.path.getsize(pdf) if has_pdf else None,
            "pdfAt": int(os.path.getmtime(pdf) * 1000) if has_pdf else None,
            "problems": problems,
            "overfull": len(OVERFULL.findall(log)),
            "log": (log or output)[-MOST_LOG_CHARS:],
        }
        temporary = os.path.join(out, "result.json.tmp")
        with open(temporary, "w", encoding="utf-8") as saved:
            json.dump(result, saved)
        os.replace(temporary, os.path.join(out, "result.json"))
        return result


def status(file):
    try:
        with open(os.path.join(folder_of(file), "result.json"), encoding="utf-8") as saved:
            return json.load(saved)
    except (OSError, ValueError):
        return {"file": file, "built": False, "ok": False, "at": None, "ms": None, "pages": None, "bytes": None, "pdfAt": None, "problems": [], "overfull": 0, "log": ""}


def read_pdf(file):
    path = os.path.join(folder_of(file), f"{os.path.splitext(os.path.basename(str(file)))[0]}.pdf")
    if not os.path.isfile(path):
        raise Refused("It hasn't made a PDF yet.")
    size = os.path.getsize(path)
    if size > MOST_PDF_BYTES:
        raise Refused(f"The PDF is {size // (1024 * 1024)} MB, over what can be shown here. Smaller images would bring it down.")
    with open(path, "rb") as pdf:
        return {"file": file, "at": int(os.path.getmtime(path) * 1000), "base64": base64.b64encode(pdf.read()).decode("ascii")}


def main():
    request = json.load(sys.stdin)
    op = request.get("op")
    file = request.get("file")
    if op == "build":
        return build(file, request.get("fresh") is True)
    if op == "status":
        return status(file)
    if op == "pdf":
        return read_pdf(file)
    raise Refused("That isn't something this can do.")


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except Refused as error:
        print(json.dumps({"error": str(error)}))
