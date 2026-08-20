/**
 * Checks that a release is coherent before it is published.
 *
 *   node scripts/verify-release.mjs v0.2.1
 *
 * The release workflow builds each platform in its own job, and each job
 * merges its own entry into `latest.json` independently. Nothing in that
 * arrangement guarantees the manifest ends up complete, or that the file a
 * signature covers is the file the manifest points at. An updater that trusts
 * a broken manifest fails silently on the user's machine, so the release stays
 * a draft until this passes.
 *
 * Verifies, for the release attached to the given tag:
 *
 *   - the manifest version matches the tag and package.json
 *   - every expected platform has an entry
 *   - every entry carries a signature
 *   - the filename inside each signature is the filename the URL points at
 *   - that file is actually attached to the release
 *
 * Requires the `gh` CLI, authenticated (GH_TOKEN on CI).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every platform the release workflow builds. Adding a matrix entry there
// means adding it here, otherwise a missing build would pass unnoticed.
const EXPECTED = ["windows-x86_64", "darwin-aarch64", "darwin-x86_64", "linux-x86_64"];

const tag = process.argv[2];
if (!tag) {
  console.error("usage: node scripts/verify-release.mjs <tag>");
  process.exit(2);
}

const gh = (args, opts = {}) =>
  execFileSync("gh", args, { encoding: "utf8", cwd: repo, ...opts });

const release = JSON.parse(gh(["release", "view", tag, "--json", "assets,isDraft,tagName"]));
const assetNames = new Set(release.assets.map((a) => a.name));

if (!assetNames.has("latest.json")) {
  fail(`the release has no latest.json asset (assets: ${[...assetNames].join(", ") || "none"})`);
}

const dir = mkdtempSync(join(tmpdir(), "onionskin-verify-"));
gh(["release", "download", tag, "--pattern", "latest.json", "--dir", dir, "--clobber"]);
const manifest = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));

const problems = [];
const check = (ok, message) => {
  if (!ok) problems.push(message);
  return ok;
};

// Compared against the tag rather than package.json: this runs from the
// workflow's own checkout, which is not the tag when a release is backfilled
// by hand. The manifest version comes from tauri.conf.json, so a config left
// un-bumped still shows up here as a mismatch.
const expectedVersion = tag.startsWith("v") ? tag.slice(1) : tag;

check(
  manifest.version === expectedVersion,
  `manifest version is ${manifest.version}, tag says ${expectedVersion}`,
);

/** Pulls the filename out of a minisign signature's trusted comment. */
function signedFilename(signature) {
  const text = Buffer.from(signature, "base64").toString("utf8");
  const line = text.split("\n").find((l) => l.startsWith("trusted comment:"));
  if (!line) return null;
  const at = line.indexOf("file:");
  return at === -1 ? null : line.slice(at + "file:".length).trim();
}

const rows = [];
for (const platform of EXPECTED) {
  const entry = (manifest.platforms || {})[platform];
  if (!check(!!entry, `no manifest entry for ${platform}`)) {
    rows.push([platform, "MISSING", "-", "-"]);
    continue;
  }

  const urlFile = decodeURIComponent(entry.url.split("/").pop() || "");
  const signed = entry.signature ? signedFilename(entry.signature) : null;

  const hasSig = check(!!entry.signature, `${platform}: empty signature`);
  const matches = check(
    signed === urlFile,
    `${platform}: signature covers ${signed}, but the URL points at ${urlFile}`,
  );
  const attached = check(
    assetNames.has(urlFile),
    `${platform}: ${urlFile} is not attached to the release`,
  );

  rows.push([platform, urlFile, hasSig && matches ? "ok" : "BAD", attached ? "ok" : "MISSING"]);
}

const widths = [0, 1, 2, 3].map((i) =>
  Math.max(...rows.map((r) => String(r[i]).length), ["platform", "file", "signature", "attached"][i].length),
);
const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");

console.log(`\n${tag} — manifest version ${manifest.version}, draft: ${release.isDraft}\n`);
console.log(line(["platform", "file", "signature", "attached"]));
console.log(line(widths.map((w) => "-".repeat(w))));
for (const r of rows) console.log(line(r));

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  if (release.isDraft) console.error("\nThe release has been left as a draft.");
  process.exit(1);
}

console.log("\nManifest is complete and coherent.\n");

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}
