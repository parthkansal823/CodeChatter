/**
 * The dev watcher compiles the tests into dist/ as well. Run only the real ones: this version
 * of Vitest no longer leaves dist/ out by itself, so each test ran twice, the copy possibly out of date.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { exclude: ["**/node_modules/**", "dist/**"] } });
