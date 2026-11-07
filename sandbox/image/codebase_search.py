"""
Ask the codebase: finds the parts of a room's files that answer a question (apps/runner/src/rag.ts runs this inside the sandbox).

Files are cut into passages, whole functions where lizard can find them, and kept in a DuckDB file in the room's home with an embedding
for each, from the room's model through the AI gateway. A search looks by meaning (cosine similarity) and by words (DuckDB's BM25), and
puts the two lists together by reciprocal rank fusion. Only files that changed are read again. Secrets never leave the sandbox: .env and
key files aren't read, and what gitleaks finds is taken out before anything is stored or sent.

Takes {"question", "limit", "model"} on stdin, and prints one JSON object.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, "/usr/local/lib/codechatter/analysis")

import duckdb  # noqa: E402
from lizard import analyze_file  # noqa: E402

WORKSPACE = "/workspace"
DATABASE = os.path.expanduser("~/.cache/codechatter/codebase-search.duckdb")
EXTENSIONS = os.path.join(os.path.dirname(os.path.dirname(duckdb.__file__)), "codechatter_duckdb_extensions")
GITLEAKS_CONFIG = "/usr/local/lib/codechatter/gitleaks.toml"

MOST_FILES = 3000
MOST_FILE_BYTES = 300_000
MOST_PASSAGES = 8000
WINDOW_LINES = 40
WINDOW_OVERLAP = 8
SHORTEST_FUNCTION_LINES = 3
LONGEST_PASSAGE_LINES = 150
MOST_PASSAGE_CHARS = 6000
MOST_EMBEDDED_CHARS = 4000
EMBED_BATCH = 32
EMBED_SECONDS = 220
RANK_CONSTANT = 60
EACH_LIST = 30

SKIP_DIRS = {"node_modules", "dist", "build", "target", "out", "vendor", "coverage", "venv", "__pycache__", ".git", ".next", ".venv", ".cache", ".pytest_cache", ".mypy_cache", ".gradle", ".idea", ".vscode", ".ipynb_checkpoints"}
SKIP_FILES = re.compile(r"(^|/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|poetry\.lock|Cargo\.lock|go\.sum)$|\.(min\.js|map|svg|csv|tsv|log|lock)$", re.I)
NEVER_READ = re.compile(r"(^|/)\.env($|\.(?!example$|sample$|template$)[^/]*$)|\.(pem|key|p12|pfx|keystore)$|(^|/)id_(rsa|ed25519|ecdsa)$", re.I)
CODE_FILES = re.compile(r"\.(py|js|jsx|mjs|cjs|ts|tsx|go|rs|java|kt|c|h|cc|cpp|hpp|cs|rb|php|swift|scala|lua|vue|sol|m|gd)$", re.I)

# The same shapes as packages/contracts/src/ai-analysis.ts: what gitleaks leaves, such as a short password. Group 1, when there is one, stays.
REMOVED = "[removed: looks like a secret]"
PLACEHOLDER = re.compile(r"""^["'](?:\$\{?[A-Za-z_]|<|\{\{|changeme|change-me|your[_-]|example|xxx|placeholder|dummy|fake)""", re.I)
SECRET_SHAPES = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)"),
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{30,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
]
ASSIGNED_SECRET = re.compile(r"""(\b[A-Za-z0-9_-]*(?:password|passwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|private[_-]?key)[A-Za-z0-9_-]*["']?\s*[:=]\s*)(["'][^"'\n]{6,}["'])""", re.I)
URL_PASSWORD = re.compile(r"(\b[a-z][a-z0-9+.-]*://[^\s:@/]+:)[^\s:@/]{3,}(?=@)", re.I)


class Refused(Exception):
    """Something the person should be told, instead of an answer."""


def clean(text):
    for shape in SECRET_SHAPES:
        text = shape.sub(REMOVED, text)
    text = ASSIGNED_SECRET.sub(lambda m: m.group(0) if PLACEHOLDER.match(m.group(2)) else f'{m.group(1)}"{REMOVED}"', text)
    return URL_PASSWORD.sub(lambda m: f"{m.group(1)}[removed]", text)


def project_files():
    """(path, text, hash) of everything worth reading, and how many there were past the limit."""
    found = []
    over = 0
    for folder, dirs, names in os.walk(WORKSPACE, followlinks=False):
        dirs[:] = sorted(name for name in dirs if name not in SKIP_DIRS)
        for name in sorted(names):
            full = os.path.join(folder, name)
            path = os.path.relpath(full, WORKSPACE)
            if os.path.islink(full) or NEVER_READ.search(path) or SKIP_FILES.search(path):
                continue
            if len(found) >= MOST_FILES:
                over += 1
                continue
            try:
                if os.path.getsize(full) > MOST_FILE_BYTES:
                    continue
                with open(full, "rb") as file:
                    raw = file.read()
                if b"\0" in raw:
                    continue
                found.append((path, raw.decode("utf-8"), hashlib.sha256(raw).hexdigest()))
            except (OSError, UnicodeDecodeError):
                continue
    return found, over


def secret_lines():
    """Where gitleaks finds secrets, by file. Without an answer from it nothing is read, rather than risking sending one."""
    try:
        done = subprocess.run(
            ["gitleaks", "dir", WORKSPACE, "--no-banner", "--redact=100", "--report-format", "json", "--report-path", "-", "--exit-code", "0", "--config", GITLEAKS_CONFIG, "--max-target-megabytes", "5", "--log-level", "error"],
            capture_output=True,
            text=True,
            timeout=120,
            check=True,
        )
        report = json.loads(done.stdout or "[]")
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        raise Refused("Couldn't check the files for secrets, so nothing was read.") from error
    places = {}
    for item in report:
        path = os.path.relpath(str(item.get("File", "")), WORKSPACE)
        lines = range(int(item.get("StartLine", 0)), int(item.get("EndLine", 0)) + 1)
        places.setdefault(path, set()).update(lines)
    return places


def windows(lines, first, last):
    """Overlapping windows of lines `first` to `last`, from 1: (start, end), leaving out blank ones."""
    start = first
    while start <= last:
        end = min(last, start + WINDOW_LINES - 1)
        if any(line.strip() for line in lines[start - 1 : end]):
            yield start, end
        if end == last:
            return
        start = end - WINDOW_OVERLAP + 1


def functions_in(path, text):
    if not CODE_FILES.search(path):
        return []
    try:
        found = analyze_file.analyze_source_code(path, text).function_list
    except Exception:  # A parser's trouble with odd code only means plain windows for this file.
        return []
    return sorted((fn for fn in found if fn.end_line - fn.start_line + 1 >= SHORTEST_FUNCTION_LINES), key=lambda fn: fn.start_line)


def passages_of(path, text, secrets):
    """(start, end, name, text) for one file: a function each where they can be found, and windows over the rest."""
    lines = text.split("\n")
    for line in secrets.get(path, ()):
        if 0 < line <= len(lines):
            lines[line - 1] = REMOVED
    spans = []
    covered = 0
    for fn in functions_in(path, text):
        if fn.start_line <= covered:
            continue
        spans.extend((start, end, "") for start, end in windows(lines, covered + 1, fn.start_line - 1))
        if fn.end_line - fn.start_line + 1 > LONGEST_PASSAGE_LINES:
            spans.extend((start, end, fn.long_name) for start, end in windows(lines, fn.start_line, fn.end_line))
        else:
            spans.append((fn.start_line, fn.end_line, fn.long_name))
        covered = fn.end_line
    spans.extend((start, end, "") for start, end in windows(lines, covered + 1, len(lines)))
    return [(start, end, name[:300], clean("\n".join(lines[start - 1 : end]))[:MOST_PASSAGE_CHARS]) for start, end, name in spans]


def searchable(text):
    """The text and the words inside its identifiers, as `parseConfig` should be found by "parse config"."""
    extra = []
    for identifier in re.findall(r"[A-Za-z_][A-Za-z0-9_]{3,}", text):
        parts = re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])", identifier)
        if len(parts) > 1:
            extra.extend(parts)
    return f"{text} {' '.join(extra)}"


def open_index():
    os.makedirs(os.path.dirname(DATABASE), exist_ok=True)
    db = duckdb.connect(DATABASE, config={"extension_directory": EXTENSIONS, "autoinstall_known_extensions": False, "autoload_known_extensions": False})
    db.execute("LOAD fts")
    # No primary keys here: DuckDB can't replace an indexed row in the transaction that deleted it, or update a list column under an index.
    db.execute("CREATE TABLE IF NOT EXISTS files (path VARCHAR, hash VARCHAR)")
    db.execute("CREATE TABLE IF NOT EXISTS passages (id BIGINT, path VARCHAR, start_line INTEGER, end_line INTEGER, name VARCHAR, body VARCHAR, search_text VARCHAR, embedding FLOAT[])")
    db.execute("CREATE TABLE IF NOT EXISTS settings (key VARCHAR PRIMARY KEY, value VARCHAR)")
    return db


def refresh(db):
    """Brings the index up to the files as they are. Returns how many files changed, and a note if some were left out."""
    files, over = project_files()
    known = dict(db.execute("SELECT path, hash FROM files").fetchall())
    current = {path: file_hash for path, _, file_hash in files}
    gone = [path for path in known if path not in current]
    changed = [(path, text, file_hash) for path, text, file_hash in files if known.get(path) != file_hash]
    note = f"Only the first {MOST_FILES} files were searched." if over else None
    if not gone and not changed:
        return 0, note
    secrets = secret_lines() if changed else {}
    next_id = db.execute("SELECT coalesce(max(id), 0) + 1 FROM passages").fetchone()[0]
    room = MOST_PASSAGES - db.execute("SELECT count(*) FROM passages").fetchone()[0]
    db.execute("BEGIN")
    for path in gone + [item[0] for item in changed]:
        room += db.execute("SELECT count(*) FROM passages WHERE path = ?", [path]).fetchone()[0]
        db.execute("DELETE FROM passages WHERE path = ?", [path])
        db.execute("DELETE FROM files WHERE path = ?", [path])
    rows = []
    for path, text, file_hash in changed:
        pieces = passages_of(path, text, secrets)
        if len(pieces) > room:
            note = "This project is too big to search all of it: some files were left out."
            continue
        room -= len(pieces)
        db.execute("INSERT INTO files VALUES (?, ?)", [path, file_hash])
        for start, end, name, body in pieces:
            rows.append([next_id, path, start, end, name, body, searchable(f"{path} {name} {body}")])
            next_id += 1
    if rows:
        db.executemany("INSERT INTO passages (id, path, start_line, end_line, name, body, search_text) VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    db.execute("COMMIT")
    return len(gone) + len(changed), note


def build_word_index(db):
    if db.execute("SELECT count(*) FROM passages").fetchone()[0]:
        db.execute("PRAGMA create_fts_index('passages', 'id', 'search_text', stemmer='porter', stopwords='english', ignore='(\\.|[^a-z])+', strip_accents=1, lower=1, overwrite=1)")


def embed(texts, model):
    """Embeddings from the room's model, through the AI gateway. The sandbox has no other way out."""
    request = urllib.request.Request(
        f"{os.environ['OPENAI_BASE_URL']}/embeddings",
        data=json.dumps({"model": model, "input": texts}).encode(),
        headers={"content-type": "application/json", "authorization": f"Bearer {os.environ.get('OPENAI_API_KEY', '')}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            data = json.load(response)["data"]
    except urllib.error.HTTPError as error:
        try:
            said = json.load(error)["error"]["message"]
        except (ValueError, KeyError, TypeError):
            said = f"the server answered {error.code}"
        raise Refused(said) from error
    except (OSError, ValueError, KeyError) as error:
        raise Refused(f"couldn't get embeddings: {error}") from error
    return [item["embedding"] for item in sorted(data, key=lambda item: item["index"])]


def for_document(model, path, name, body):
    # Nomic's models are trained with these prefixes on what's stored and what's asked.
    text = f"{path}\n{name}\n{body}"[:MOST_EMBEDDED_CHARS]
    return f"search_document: {text}" if model.startswith("nomic") else text


def for_question(model, question):
    return f"search_query: {question}" if model.startswith("nomic") else question


def embed_what_is_new(db, model):
    """Returns how many were embedded, how many are still waiting, and a note if it had to stop."""
    if db.execute("SELECT value FROM settings WHERE key = 'model'").fetchone() != (model,):
        db.execute("UPDATE passages SET embedding = NULL")
        db.execute("INSERT OR REPLACE INTO settings VALUES ('model', ?)", [model])
    deadline = time.monotonic() + EMBED_SECONDS
    done = 0
    note = None
    while True:
        batch = db.execute("SELECT id, path, name, body FROM passages WHERE embedding IS NULL ORDER BY id LIMIT ?", [EMBED_BATCH]).fetchall()
        if not batch:
            break
        if time.monotonic() > deadline:
            note = "The index isn't finished, so this searched by words for some files. Ask again to carry on."
            break
        try:
            vectors = embed([for_document(model, path, name, body) for _, path, name, body in batch], model)
        except Refused as error:
            note = f"Searched by words only: {error}"
            break
        db.execute("BEGIN")
        db.executemany("UPDATE passages SET embedding = ? WHERE id = ?", [[vector, row[0]] for vector, row in zip(vectors, batch)])
        db.execute("COMMIT")
        done += len(batch)
    waiting = db.execute("SELECT count(*) FROM passages WHERE embedding IS NULL").fetchone()[0]
    return done, waiting, note


def search(db, question, model, limit):
    """Reciprocal rank fusion of what's nearest in meaning and what has the words: each list counts by rank, not by a score the other can't be compared with."""
    by_meaning = []
    note = None
    if model and db.execute("SELECT count(*) FROM passages WHERE embedding IS NOT NULL").fetchone()[0]:
        try:
            [vector] = embed([for_question(model, question)], model)
            by_meaning = [row[0] for row in db.execute("SELECT id FROM passages WHERE embedding IS NOT NULL ORDER BY list_cosine_similarity(embedding, ?::FLOAT[]) DESC LIMIT ?", [vector, EACH_LIST]).fetchall()]
        except Refused as error:
            note = f"Searched by words only: {error}"
    by_words = []
    if db.execute("SELECT count(*) FROM passages").fetchone()[0]:
        rows = db.execute(
            "SELECT id, fts_main_passages.match_bm25(id, ?) AS score FROM passages WHERE score IS NOT NULL ORDER BY score DESC LIMIT ?",
            [searchable(question), EACH_LIST],
        ).fetchall()
        by_words = [row[0] for row in rows]
    scores = {}
    for ranked in (by_meaning, by_words):
        for rank, passage in enumerate(ranked):
            scores[passage] = scores.get(passage, 0) + 1 / (RANK_CONSTANT + rank + 1)
    best = sorted(scores, key=lambda passage: (-scores[passage], passage))[:limit]
    found = []
    for passage in best:
        path, start, end, name, body = db.execute("SELECT path, start_line, end_line, name, body FROM passages WHERE id = ?", [passage]).fetchone()
        how = "both" if passage in by_meaning and passage in by_words else "meaning" if passage in by_meaning else "words"
        found.append({"path": path, "start": start, "end": end, "name": name, "text": body, "score": round(scores[passage], 5), "found": how})
    return found, note


def main():
    started = time.monotonic()
    request = json.load(sys.stdin)
    question = str(request["question"])
    limit = int(request.get("limit") or 8)
    model = request.get("model") or None
    db = open_index()
    changed, note = refresh(db)
    if changed or not db.execute("SELECT 1 FROM duckdb_schemas() WHERE schema_name = 'fts_main_passages'").fetchone():
        build_word_index(db)
    embedded, waiting = 0, db.execute("SELECT count(*) FROM passages WHERE embedding IS NULL").fetchone()[0]
    if model:
        embedded, waiting, embed_note = embed_what_is_new(db, model)
        note = note or embed_note
    else:
        note = note or "Searched by words only: this server has no embedding model."
    passages, search_note = search(db, question, model, limit)
    files, chunks = db.execute("SELECT (SELECT count(*) FROM files), (SELECT count(*) FROM passages)").fetchone()
    db.close()
    print(json.dumps({"passages": passages, "index": {"files": files, "chunks": chunks, "changed": changed, "embedded": embedded, "waiting": waiting, "ms": round((time.monotonic() - started) * 1000), "model": model}, "note": note or search_note}))


if __name__ == "__main__":
    try:
        main()
    except Refused as error:
        print(json.dumps({"error": str(error)}))
