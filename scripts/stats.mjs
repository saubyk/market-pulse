#!/usr/bin/env node
// Builds the stats pack the commentary model is given (SPEC §3.7):
//
//   node scripts/snapshot.mjs --history-out /tmp/history.json
//   node scripts/stats.mjs --history /tmp/history.json --out /tmp/stats.json
//
// Reads the year of daily closes dumped by the snapshot step plus the
// committed snapshot log, merges them (the log wins on shared dates), and
// writes the pack — or prints it when --out is omitted. Pure computation
// lives in scripts/trends.mjs; this file only does I/O.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { buildStatsPack } from "./trends.mjs";

const SNAPSHOT_PATH = "public/data/snapshots.jsonl";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function readSnapshots() {
  try {
    const text = await readFile(SNAPSHOT_PATH, "utf8");
    return text
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

async function main() {
  const historyPath = arg("--history");
  const outPath = arg("--out");

  let asOf = Date.now();
  let histories = {};
  if (historyPath) {
    const dump = JSON.parse(await readFile(historyPath, "utf8"));
    histories = dump.history ?? {};
    if (typeof dump.asOf === "number") asOf = dump.asOf;
  }
  const snapshots = await readSnapshots();

  const pack = buildStatsPack({ asOf, histories, snapshots });
  const json = JSON.stringify(pack, null, 2);
  if (outPath) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, json);
    const have = Object.entries(pack.instruments).filter(([, s]) => s).length;
    console.log(
      `wrote stats for ${pack.date} (${have}/${Object.keys(pack.instruments).length} instruments, trading day: ${pack.tradingDay}) to ${outPath}`,
    );
  } else {
    console.log(json);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
