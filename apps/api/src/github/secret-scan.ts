import type { SecretFinding } from "@codechatter/contracts";
import { UnprocessableEntityException } from "@nestjs/common";

/**
 * Keys and passwords in files about to leave for GitHub (a commit, a new repository, a gist):
 * well-known token shapes, private keys, a password in a database URL, and a secret-looking
 * value given to a password, secret, token or API-key name. Placeholders ("changeme",
 * "${API_KEY}", "your-key-here") and a line marked `gitleaks:allow` or `pragma: allowlist
 * secret` are let through. The preview shows only a secret's ends.
 */
type Rule = {
  kind: string;
  pattern: RegExp;
  /** The capture group holding the secret (the whole match by default). */
  group?: number;
  /** The secret itself, shown as it is (a private key's header). */
  plain?: boolean;
  /** Only in files whose name this matches. */
  files?: RegExp;
  /** Only values that look made up, not placeholders or words. */
  random?: boolean;
  /** Skip the match (a local database's URL). */
  skip?: (match: RegExpExecArray) => boolean;
};

const NAME = "(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|access[_-]?token|client[_-]?secret|private[_-]?key)";
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[a-z0-9_-]+)(?::\d+)?$/i;

const RULES: Rule[] = [
  { kind: "Private key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g, plain: true },
  { kind: "AWS access key ID", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "AWS secret access key", pattern: /aws_?secret_?access_?key["']?\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi, group: 1 },
  { kind: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/g },
  { kind: "GitLab token", pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { kind: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "Slack webhook", pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{16,}/g },
  { kind: "Stripe live key", pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { kind: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g },
  { kind: "Anthropic API key", pattern: /\bsk-ant-[a-z]+\d{2}-[A-Za-z0-9_-]{80,}/g },
  { kind: "OpenAI API key", pattern: /\bsk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}|[A-Za-z0-9]{48}(?![A-Za-z0-9]))/g },
  { kind: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: "SendGrid API key", pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g },
  {
    kind: "Password in a database URL",
    pattern: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?):\/\/[^\s:/@"'`]+:([^\s@"'`/]+)@([^\s/"'`?]+)/gi,
    group: 1,
    random: true,
    skip: (match) => LOCAL_HOST.test(match[2] ?? ""),
  },
  {
    kind: "Secret in an .env file",
    pattern: /^[ \t]*(?:export[ \t]+)?[A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*[ \t]*=[ \t]*["']?([^\s"']{8,})/gm,
    group: 1,
    files: /(?:^|\/)\.env(?:\.[^/]*)?$/,
    random: true,
  },
  {
    kind: "Hard-coded secret",
    pattern: new RegExp(`["']?[A-Za-z0-9_]*${NAME}[A-Za-z0-9_]*["']?\\s*(?::=|=>|[:=])\\s*["'\`]([^"'\`\\s]{12,})["'\`]`, "gi"),
    group: 1,
    random: true,
  },
];

const ALLOW_LINE = /gitleaks:allow|pragma: allowlist secret/;
const PLACEHOLDER = /^(?:x+|\*+|\.+|-+|_+)$|change[_-]?me|placeholder|your[_-]|<[^>]*>|^\$|\$\{|\{\{|%[a-z(]|process\.env|os\.environ|getenv|env\(|dummy|sample|redacted|replace|insert|todo|secret_here|key_here|password_here/i;
/** A documentation or test value in a real token's shape: the docs' EXAMPLE, or a run like "abcdefg" or "1234567". */
const FAKE = /example|fake|x{8}|0123456|1234567|abcdefg/i;
/** Names, words and word-like values: "OPENAI_API_KEY", "development-only-not-secret", "codechatter123". */
const WORDS = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$|^[a-z]+(?:[-_.][a-z]+)+$|^[A-Za-z][a-z]+[0-9]{0,4}[!?.]?$/;

/** Bits per character: a made-up key is high (over 3), a word or "aaaaaaaa" is low. */
function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** Looks made up: not a placeholder, mixed characters, and enough entropy for its length. */
function looksRandom(value: string): boolean {
  if (PLACEHOLDER.test(value) || WORDS.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((c) => c.test(value)).length;
  if (classes < 2) return false;
  return entropy(value) >= (value.length >= 20 ? 3.5 : 3);
}

/** The secret's ends, enough to recognise it and not enough to use it. */
export function mask(secret: string): string {
  if (secret.length <= 8) return `${secret.slice(0, 1)}…`;
  if (secret.length <= 16) return `${secret.slice(0, 3)}…${secret.slice(-2)}`;
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

/** At most this many findings: enough to see what's wrong. */
export const MAX_FINDINGS = 50;

/** The secrets in these files, in file order, at most MAX_FINDINGS. A secret repeated in a file counts once. */
export function scanSecrets(files: ReadonlyArray<{ path: string; content: string | null }>): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { path, content } of files) {
    if (!content || content.includes("\0")) continue;
    const lineStarts = [0];
    for (let at = content.indexOf("\n"); at !== -1; at = content.indexOf("\n", at + 1)) lineStarts.push(at + 1);
    const lineOf = (offset: number) => {
      let low = 0;
      let high = lineStarts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (lineStarts[middle]! <= offset) low = middle;
        else high = middle - 1;
      }
      return low;
    };
    const seen = new Set<string>();
    const found: SecretFinding[] = [];
    const covered: Array<[number, number]> = [];
    for (const rule of RULES) {
      if (rule.files && !rule.files.test(path)) continue;
      rule.pattern.lastIndex = 0;
      for (let match = rule.pattern.exec(content); match; match = rule.pattern.exec(content)) {
        const secret = match[rule.group ?? 0];
        if (!secret) continue;
        const start = match.index + match[0].lastIndexOf(secret);
        const end = start + secret.length;
        // A token a more specific rule found already (a GitHub token in GITHUB_TOKEN=...).
        if (covered.some(([from, to]) => start < to && end > from)) continue;
        if ((rule.random && !looksRandom(secret)) || (!rule.plain && FAKE.test(secret))) continue;
        if (rule.skip?.(match)) continue;
        const line = lineOf(start);
        const text = content.slice(lineStarts[line], (lineStarts[line + 1] ?? content.length + 1) - 1);
        if (ALLOW_LINE.test(text)) continue;
        covered.push([start, end]);
        if (seen.has(secret)) continue;
        seen.add(secret);
        found.push({ path, line: line + 1, kind: rule.kind, preview: rule.plain ? secret : mask(secret) });
      }
    }
    findings.push(...found.sort((a, b) => a.line - b.line));
    if (findings.length >= MAX_FINDINGS) return findings.slice(0, MAX_FINDINGS);
  }
  return findings;
}

/** Refuse files with secrets in them, unless the sender has seen the findings and goes ahead; the findings either way. */
export function refuseSecrets(files: ReadonlyArray<{ path: string; content: string | null }>, allow: boolean, what: string): SecretFinding[] {
  const findings = scanSecrets(files);
  if (findings.length && !allow) {
    const count = findings.length >= MAX_FINDINGS ? `${MAX_FINDINGS} or more` : String(findings.length);
    throw new UnprocessableEntityException({
      message: `This ${what} looks like it has ${count === "1" ? "a key or password" : `${count} keys or passwords`} in it. Take ${count === "1" ? "it" : "them"} out, or go ahead if ${count === "1" ? "it isn't a real secret" : "they aren't real secrets"}.`,
      secrets: findings,
    });
  }
  return findings;
}
