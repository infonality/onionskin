/**
 * Checks that a release is coherent before it is published.
 *
 *   node scripts/verify-release.mjs v0.2.1
 *
 * The release workflow builds each platform in its own job, and each job
 * merges its own entry into `latest.json` independently. Nothing in that
 * arrangement guarantees the manifest ends up complete, or that a signature
 * matches the bytes GitHub is actually serving. An updater that trusts a
 * broken manifest fails silently on the user's machine, so the release stays a
 * draft until this passes.
 *
 * For the release attached to the given tag, verifies that:
 *
 *   - the manifest version matches the tag
 *   - every expected platform has an entry
 *   - the filename inside each signature is the file its URL points at
 *   - that file is attached to the release
 *   - the signature validates against the downloaded bytes, under the same
 *     public key the app ships in tauri.conf.json
 *
 * The last one is the point. Everything above it is metadata agreeing with
 * other metadata; only verifying against the real artifact, with the key the
 * installed app will use, proves an update can actually be applied.
 *
 * Requires the `gh` CLI, authenticated (GH_TOKEN on CI).
 */
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every platform the release workflow builds. Adding a matrix entry there
// means adding it here, otherwise a missing build would pass unnoticed.
const EXPECTED = ["windows-x86_64", "darwin-aarch64", "darwin-x86_64", "linux-x86_64"];

// DER prefix that turns 32 raw Ed25519 bytes into an SPKI key Node will load.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const tag = process.argv[2];
if (!tag) {
  console.error("usage: node scripts/verify-release.mjs <tag>");
  process.exit(2);
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", cwd: repo });

const release = JSON.parse(gh(["release", "view", tag, "--json", "assets,isDraft"]));
const assetNames = new Set(release.assets.map((a) => a.name));
const dir = mkdtempSync(join(tmpdir(), "onionskin-verify-"));

if (!assetNames.has("latest.json")) {
  console.error(`error: no latest.json attached to ${tag}`);
  process.exit(1);
}

const download = (name) =>
  gh(["release", "download", tag, "--pattern", name, "--dir", dir, "--clobber"]);

download("latest.json");
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

/** The public half the installed app checks updates against. */
function appPublicKey() {
  const conf = JSON.parse(readFileSync(join(repo, "src-tauri/tauri.conf.json"), "utf8"));
  const text = Buffer.from(conf.plugins.updater.pubkey, "base64").toString("utf8");
  const body = text.split("\n").map((l) => l.trim()).filter(Boolean)[1];
  const raw = Buffer.from(body, "base64");
  return { keyId: raw.subarray(2, 10), key: raw.subarray(10, 42) };
}

/** Splits a minisign signature file into its parts. */
function parseSignature(base64File) {
  const text = Buffer.from(base64File, "base64").toString("utf8");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const payload = Buffer.from(lines[1] ?? "", "base64");
  const trusted = lines.find((l) => l.startsWith("trusted comment:")) ?? "";
  const at = trusted.indexOf("file:");
  return {
    // "ED" signs a BLAKE2b-512 hash of the file; legacy "Ed" signs it whole.
    algorithm: payload.subarray(0, 2).toString("latin1"),
    keyId: payload.subarray(2, 10),
    signature: payload.subarray(10, 74),
    file: at === -1 ? null : trusted.slice(at + "file:".length).trim(),
  };
}

function signatureCovers(bytes, parsed, pub) {
  if (!parsed.keyId.equals(pub.keyId)) return "signed by a different key";
  const message = parsed.algorithm === "ED" ? createHash("blake2b512").update(bytes).digest() : bytes;
  const key = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, pub.key]),
    format: "der",
    type: "spki",
  });
  return edVerify(null, message, key, parsed.signature) ? null : "signature does not match the file";
}

const pub = appPublicKey();
const rows = [];

for (const platform of EXPECTED) {
  const entry = (manifest.platforms || {})[platform];
  if (!check(!!entry, `no manifest entry for ${platform}`)) {
    rows.push([platform, "MISSING", "-", "-"]);
    continue;
  }
  if (!check(!!entry.signature, `${platform}: empty signature`)) {
    rows.push([platform, entry.url.split("/").pop() ?? "?", "EMPTY", "-"]);
    continue;
  }

  const urlFile = decodeURIComponent(entry.url.split("/").pop() ?? "");
  const parsed = parseSignature(entry.signature);

  check(
    parsed.file === urlFile,
    `${platform}: signature covers ${parsed.file}, the URL points at ${urlFile}`,
  );

  if (!check(assetNames.has(urlFile), `${platform}: ${urlFile} is not attached to the release`)) {
    rows.push([platform, urlFile, "-", "MISSING"]);
    continue;
  }

  download(urlFile);
  const bytes = readFileSync(join(dir, urlFile));
  const failure = signatureCovers(bytes, parsed, pub);
  check(!failure, failure ? `${platform}: ${failure}` : "");

  rows.push([
    platform,
    urlFile,
    failure ? "BAD" : "verified",
    `${(bytes.length / 1048576).toFixed(1)} MB`,
  ]);
}

const headers = ["platform", "file", "signature", "size"];
const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");

console.log(`\n${tag} — manifest version ${manifest.version}, draft: ${release.isDraft}\n`);
console.log(line(headers));
console.log(line(widths.map((w) => "-".repeat(w))));
for (const r of rows) console.log(line(r));

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  if (release.isDraft) console.error("\nThe release has been left as a draft.");
  process.exit(1);
}

console.log("\nEvery platform is present, and every signature validates against the published bytes.\n");
