#!/usr/bin/env node
// Generates the day's "Today's read" from a stats pack (SPEC §3.8):
//
//   node scripts/stats.mjs --history h.json --out stats.json
//   node scripts/commentary.mjs --stats stats.json            # writes public/data/commentary.json + .jsonl
//   node scripts/commentary.mjs --stats stats.json --dry-run  # prints the prompt, calls nothing
//   node scripts/commentary.mjs --stats stats.json --force    # rewrite even if the session has a note
//
// Runs in CI after the snapshot and stats steps. ANTHROPIC_API_KEY comes
// from a repo secret; when it is absent (forks, local runs) the script
// prints a notice and exits 0 so the snapshot pipeline still completes.
// A session that already has a note (a weekend or holiday run resolves
// to Friday's session) is skipped without calling the API — pass --force
// to regenerate it.
//
// Model: claude-fable-5. Thinking is always on for this model — the
// `thinking` parameter is deliberately omitted — and depth is set with
// output_config.effort. Server-side refusal fallbacks are enabled so a
// classifier decline (HTTP 200, stop_reason "refusal") is re-run on
// Anthropic's recommended fallback inside the same call; whichever model
// actually answered is recorded in the output as `model`.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import {
  ARCHIVE_PATH,
  COMMENTARY_PATH,
  EFFORT,
  MAX_TOKENS,
  MODEL,
  OUTPUT_SCHEMA,
  SYSTEM_PROMPT,
  buildDocument,
  noteExistsFor,
  responseText,
  upsertArchive,
  userMessage,
  validateOutput,
} from "./commentary-lib.mjs";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function requestParams(pack) {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: EFFORT,
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    // The system prompt is frozen text, but the job runs once a day and
    // the prompt cache lives minutes, so no cache_control: a write would
    // cost the 25% premium for a read that never comes.
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage(pack) }],
  };
}

async function generate(pack) {
  const client = new Anthropic();
  const response = await client.beta.messages.create(requestParams(pack));

  if (response.stop_reason === "refusal") {
    const d = response.stop_details;
    throw new Error(
      `model refused (category ${d?.category ?? "unknown"}): ${d?.explanation ?? ""}`,
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("response truncated at max_tokens");
  }

  const text = responseText(response);
  if (!text) throw new Error("no text block in response");
  let output;
  try {
    output = JSON.parse(text);
  } catch (e) {
    throw new Error(`response was not JSON: ${e.message}\n${text}`);
  }
  const problems = validateOutput(output);
  if (problems.length) {
    throw new Error(`output failed validation: ${problems.join("; ")}\n${text}`);
  }

  return { output, model: response.model, usage: response.usage };
}

async function main() {
  const statsPath = arg("--stats");
  if (!statsPath) {
    console.error("usage: node scripts/commentary.mjs --stats <stats.json> [--dry-run]");
    process.exit(2);
  }
  const dryRun = process.argv.includes("--dry-run");
  const pack = JSON.parse(await readFile(statsPath, "utf8"));

  if (dryRun) {
    const p = requestParams(pack);
    console.log(`model ${p.model} · effort ${p.output_config.effort} · max_tokens ${p.max_tokens}`);
    console.log("\n--- system ---\n" + SYSTEM_PROMPT);
    console.log("\n--- user ---\n" + p.messages[0].content);
    return;
  }

  let archive = "";
  try {
    archive = await readFile(ARCHIVE_PATH, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (!process.argv.includes("--force") && noteExistsFor(archive, pack.date)) {
    console.log(`session ${pack.date} already has a note — skipping (pass --force to regenerate).`);
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("ANTHROPIC_API_KEY not set — skipping commentary generation.");
    return;
  }

  const generatedAt = Date.now();
  const { output, model, usage } = await generate(pack);
  const doc = buildDocument({ pack, output, model, usage, generatedAt });

  await mkdir(dirname(COMMENTARY_PATH), { recursive: true });
  await writeFile(COMMENTARY_PATH, JSON.stringify(doc, null, 2) + "\n");
  await writeFile(ARCHIVE_PATH, upsertArchive(archive, doc));

  const u = doc.usage ?? {};
  console.log(
    `wrote ${doc.date} commentary (${model}; in ${u.inputTokens} / cached ${u.cacheReadTokens} / out ${u.outputTokens} tokens)`,
  );
  if (!String(model).startsWith(MODEL)) {
    console.log(`note: answered by fallback model ${model}`);
  }
  console.log(`\n${doc.headline}\n\n${doc.body.join("\n\n")}`);
}

main().catch((e) => {
  if (e instanceof Anthropic.APIError) {
    console.error(`Anthropic API error ${e.status}: ${e.message}`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
