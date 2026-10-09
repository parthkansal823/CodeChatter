import { describe, expect, it } from "vitest";

import { databaseEnv, databasePassword } from "./databases.js";

const SECRET = "x".repeat(32);

describe("databasePassword", () => {
  it("is the same for a room every time, and different for each room", () => {
    expect(databasePassword(SECRET, "E2ETST")).toBe(databasePassword(SECRET, "E2ETST"));
    expect(databasePassword(SECRET, "E2ETST")).not.toBe(databasePassword(SECRET, "TEAM22"));
    expect(databasePassword("y".repeat(32), "E2ETST")).not.toBe(databasePassword(SECRET, "E2ETST"));
  });

  it("is safe to put in a URL or a shell argument as it is", () => {
    expect(databasePassword(SECRET, "E2ETST")).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});

describe("databaseEnv", () => {
  const password = databasePassword(SECRET, "E2ETST");
  const env = Object.fromEntries(databaseEnv(password).map((line) => line.split(/=(.*)/s).slice(0, 2)));

  it("gives each database a URL, by name on the room network", () => {
    expect(env.POSTGRES_URL).toBe(`postgresql://app:${password}@postgres:5432/app`);
    expect(env.MYSQL_URL).toBe(`mysql://app:${password}@mysql:3306/app`);
    expect(env.MARIADB_URL).toBe(`mysql://app:${password}@mariadb:3306/app`);
    expect(env.MONGODB_URL).toBe(`mongodb://app:${password}@mongo:27017/app?authSource=admin`);
    expect(env.REDIS_URL).toBe(`redis://default:${password}@redis:6379/0`);
  });

  it("points DATABASE_URL and the command-line clients at them", () => {
    expect(env.DATABASE_URL).toBe(env.POSTGRES_URL);
    expect([env.PGHOST, env.PGUSER, env.PGDATABASE, env.PGPASSWORD]).toEqual(["postgres", "app", "app", password]);
    expect(env.MYSQL_PWD).toBe(password);
  });
});
