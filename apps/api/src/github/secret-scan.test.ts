import { UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { mask, MAX_FINDINGS, refuseSecrets, scanSecrets } from "./secret-scan.js";

// Made-up secrets in each provider's shape; built from parts so this file isn't one itself.
const AWS_ID = ["AKIA", "Z7QK2M4XW9PLR3TB"].join("");
const AWS_SECRET = ["kT9rQ2vX7mZp4LwN8sYb", "3HcJ6fGd1EaU5oRi0VtK"].join("");
const GITHUB = ["ghp_", "R8kd2LmQ9xZp4TnW7vYb3HcJ6fGd1EaU5oRi"].join("");
const STRIPE = ["sk_live_", "51HqZ8kLmQ9xZp4TnW7vYb3HcJ"].join("");
const GOOGLE = ["AIza", "SyD8kLmQ9xZp4TnW7vYb3HcJ6fGd1EaU5oR"].join("");
const one = (path: string, content: string) => scanSecrets([{ path, content }]);
const kinds = (path: string, content: string) => one(path, content).map((f) => f.kind);

describe("scanSecrets", () => {
  it("finds well-known token shapes, with the line and only the ends shown", () => {
    const found = one("src/config.ts", `const region = "eu-west-1";\nconst id = "${AWS_ID}";\nconst gh = "${GITHUB}";\n`);
    expect(found).toEqual([
      { path: "src/config.ts", line: 2, kind: "AWS access key ID", preview: "AKIA…R3TB" },
      { path: "src/config.ts", line: 3, kind: "GitHub token", preview: `ghp_…${GITHUB.slice(-4)}` },
    ]);
    expect(kinds("pay.py", `stripe.api_key = "${STRIPE}"`)).toEqual(["Stripe live key"]);
    expect(kinds("index.html", `<script src="https://maps.googleapis.com/maps/api/js?key=${GOOGLE}"></script>`)).toEqual(["Google API key"]);
    expect(kinds("notify.js", `fetch("https://hooks.slack.com/services/T0ABCDEF1/B0ABCDEF2/${"kT9rQ2vX7mZp4LwN8sYb"}")`)).toEqual(["Slack webhook"]);
  });

  it("finds a private key, showing its header", () => {
    const found = one("deploy/id_rsa", "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----\n");
    expect(found).toEqual([{ path: "deploy/id_rsa", line: 1, kind: "Private key", preview: "-----BEGIN OPENSSH PRIVATE KEY-----" }]);
    expect(kinds("README.md", "Public keys start with -----BEGIN PUBLIC KEY-----.")).toEqual([]);
  });

  it("finds an AWS secret key by its name, and one token once even where two rules match", () => {
    expect(kinds("credentials", `[default]\naws_secret_access_key = ${AWS_SECRET}\n`)).toEqual(["AWS secret access key"]);
    // GITHUB_TOKEN=ghp_... is a GitHub token, not also an .env secret.
    expect(kinds(".env", `GITHUB_TOKEN=${GITHUB}\n`)).toEqual(["GitHub token"]);
    // The same key twice in a file counts once.
    expect(kinds("a.ts", `"${AWS_ID}" + "${AWS_ID}"`)).toEqual(["AWS access key ID"]);
  });

  it("finds made-up values in .env files, not placeholders or other settings", () => {
    const env = [
      "APP_NAME=Laravel",
      "APP_KEY=base64:jVWX4qdo9Ge1AQdRoWbK6bauN2BEMibe67KI212lZjQ=",
      "DB_PASSWORD=Zq8!vR2#mK9pL4",
      "JWT_SECRET=changeme",
      "API_TOKEN=${API_TOKEN}",
      "SMTP_PASSWORD=",
      "export SESSION_SECRET='h7Gk2pQ9zX4mW8vN3bR6'",
    ].join("\n");
    expect(one(".env", env).map((f) => [f.line, f.kind])).toEqual([
      [3, "Secret in an .env file"],
      [7, "Secret in an .env file"],
    ]);
    expect(kinds(".env.production", "DB_PASSWORD=Zq8!vR2#mK9pL4")).toEqual(["Secret in an .env file"]);
    // The same line outside an .env file isn't a quoted assignment, so it's left alone.
    expect(kinds("notes.txt", "DB_PASSWORD=Zq8!vR2#mK9pL4")).toEqual([]);
  });

  it("finds hard-coded secrets in code, not words, placeholders or reads from the environment", () => {
    expect(kinds("app.py", `client_secret = "q8Zt3Lw9Vx2Np7Rk4Bm6"`)).toEqual(["Hard-coded secret"]);
    expect(kinds("config.json", `{ "apiKey": "Xk29fLq8Zt3Lw9Vx2Np7" }`)).toEqual(["Hard-coded secret"]);
    expect(kinds("main.go", "password := `Pq7!xZ2mL9vR4kW8`")).toEqual(["Hard-coded secret"]);
    expect(kinds("app.py", `password = "correcthorsebattery"`)).toEqual([]);
    expect(kinds("app.py", `api_key = "your-api-key-here"`)).toEqual([]);
    expect(kinds("app.ts", "const secret = process.env.SESSION_SECRET;")).toEqual([]);
    expect(kinds("form.tsx", `<input type="password" name="password" placeholder="Password" />`)).toEqual([]);
    expect(kinds("app.ts", `const apiKey = "\${process.env.KEY}";`)).toEqual([]);
    // Names, words and word-like test values.
    expect(kinds("ai.ts", `const keyName = useOpenAi ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";`)).toEqual([]);
    expect(kinds("settings.py", `SECRET_KEY = "development-only-not-secret"`)).toEqual([]);
    expect(kinds("seed.ts", `const PASSWORD = "codechatter123";`)).toEqual([]);
    expect(kinds("run.sh", `MYSQL_PWD="$CC_PASSWORD" mysql`)).toEqual([]);
  });

  it("lets documentation and test values in a real token's shape through", () => {
    expect(kinds("README.md", `aws_access_key_id = ${["AKIA", "IOSFODNN7EXAMPLE"].join("")}`)).toEqual([]);
    expect(kinds("token.test.ts", `const token = "${["ghp_", "abcdefghijklmnopqrstuvwxyz0123456789"].join("")}";`)).toEqual([]);
  });

  it("finds a password in a database URL, unless the database is local", () => {
    expect(kinds("db.ts", `connect("postgres://app:Zq8vR2mK9pL4xT7w@db.example.com:5432/app")`)).toEqual(["Password in a database URL"]);
    expect(kinds("db.ts", `connect("mongodb+srv://app:Zq8vR2mK9pL4xT7w@cluster0.ab1cd.mongodb.net/app")`)).toEqual(["Password in a database URL"]);
    expect(kinds("compose.yaml", "DATABASE_URL: postgres://postgres:Zq8vR2mK9pL4xT7w@db:5432/app")).toEqual([]);
    expect(kinds("db.ts", `connect("postgres://app:Zq8vR2mK9pL4xT7w@localhost:5432/app")`)).toEqual([]);
    expect(kinds("db.ts", `connect("postgres://app:password@db.example.com/app")`)).toEqual([]);
  });

  it("skips lines marked as allowed, binary files and deletions", () => {
    expect(kinds("test.ts", `const fake = "${AWS_ID}"; // gitleaks:allow`)).toEqual([]);
    expect(kinds("test.py", `KEY = "${AWS_ID}"  # pragma: allowlist secret`)).toEqual([]);
    expect(kinds("image.bin", `\0\0${AWS_ID}`)).toEqual([]);
    expect(scanSecrets([{ path: "gone.ts", content: null }])).toEqual([]);
  });

  it("keeps the files' order and stops at the cap", () => {
    const files = [
      { path: "b.ts", content: `x = "${GITHUB}"` },
      { path: "a.ts", content: `\n\ny = "${AWS_ID}"` },
    ];
    expect(scanSecrets(files).map((f) => `${f.path}:${f.line}`)).toEqual(["b.ts:1", "a.ts:3"]);
    const many = Array.from({ length: 80 }, (_, i) => ({ path: `k${i}.ts`, content: `"AKIA${String(i).padStart(16, "Q")}"` }));
    expect(scanSecrets(many)).toHaveLength(MAX_FINDINGS);
  });
});

describe("mask", () => {
  it("shows a secret's ends only, less of a short one", () => {
    expect(mask(AWS_ID)).toBe("AKIA…R3TB");
    expect(mask("Zq8!vR2#mK9pL4")).toBe("Zq8…L4");
    expect(mask("abcdefgh")).toBe("a…");
  });
});

describe("refuseSecrets", () => {
  const files = [{ path: "a.ts", content: `"${AWS_ID}"` }];

  it("refuses with the findings, unless the sender goes ahead", () => {
    try {
      refuseSecrets(files, false, "commit");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      const body = (error as UnprocessableEntityException).getResponse() as { message: string; secrets: unknown[] };
      expect(body.message).toBe("This commit looks like it has a key or password in it. Take it out, or go ahead if it isn't a real secret.");
      expect(body.secrets).toHaveLength(1);
    }
    expect(refuseSecrets(files, true, "commit")).toHaveLength(1);
    expect(refuseSecrets([{ path: "a.ts", content: "hello" }], false, "commit")).toEqual([]);
  });
});
