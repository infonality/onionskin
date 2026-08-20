/**
 * Prepares an update release.
 *
 *   node scripts/release.mjs [--notes "What changed"]
 *
 * Reads the version from package.json, locates the signed installers that
 * `npm run app:build` produced, and writes the `latest.json` manifest the
 * updater fetches. Prints the `gh release create` command to publish them.
 *
 * The signature files only exist when the build ran with the signing key in
 * the environment:
 *
 *   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.onionskin/updater.key)"
 *   npm run app:build
 *
 * Tauri reads the key contents from that variable; the _PATH variant is not
 * honoured by the bundler and the build will silently produce no signatures.
 *
 * Without that, Tauri builds installers but no `.sig`, and the updater will
 * reject them.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const conf = JSON.parse(readFileSync(join(repo, "src-tauri/tauri.conf.json"), "utf8"));

if (pkg.version !== conf.version) {
  throw new Error(
    `version mismatch: package.json is ${pkg.version}, tauri.conf.json is ${conf.version}`,
  );
}

const version = pkg.version;
const tag = `v${version}`;
const notesFlag = process.argv.indexOf("--notes");
const notes = notesFlag > -1 ? process.argv[notesFlag + 1] : `Onionskin ${version}`;

const REPO_SLUG = "infonality/onionskin";
const bundle = join(repo, "src-tauri/target/release/bundle");

/** Finds one file in a bundle directory, plus its detached signature. */
function artifact(dir, matcher) {
  const full = join(bundle, dir);
  if (!existsSync(full)) return null;
  const name = readdirSync(full).find(matcher);
  if (!name) return null;
  const sigPath = join(full, `${name}.sig`);
  return {
    name,
    path: join(full, name),
    signature: existsSync(sigPath) ? readFileSync(sigPath, "utf8").trim() : null,
  };
}

// NSIS is what the Windows updater installs: it can replace a running install
// without the MSI's elevation dance. The MSI is only for first-time installs.
const nsis = artifact("nsis", (f) => f.endsWith("-setup.exe"));
const msi = artifact("msi", (f) => f.endsWith(".msi"));

if (!nsis) {
  throw new Error(
    "no NSIS installer found — run `npm run app:build` first (targets include nsis)",
  );
}

const unsigned = [];
if (!nsis.signature) unsigned.push(nsis.name);

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: nsis.signature ?? "",
      url: `https://github.com/${REPO_SLUG}/releases/download/${tag}/${nsis.name}`,
    },
  },
};

const outDir = join(repo, "dist-release");
mkdirSync(outDir, { recursive: true });
const manifestPath = join(outDir, "latest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const assets = [nsis.path, msi?.path, manifestPath].filter(Boolean);

console.log(`\nOnionskin ${version}\n`);
console.log("Artifacts");
for (const a of assets) console.log(`  ${a.replace(repo + "\\", "").replace(repo + "/", "")}`);

if (unsigned.length) {
  console.log(
    `\n  WARNING: ${unsigned.join(", ")} has no .sig — the updater will reject it.` +
      `\n  Rebuild with TAURI_SIGNING_PRIVATE_KEY set to the key contents.`,
  );
}

console.log(`\nPublish with\n`);
console.log(
  `  gh release create ${tag} \\\n` +
    assets.map((a) => `    "${a}"`).join(" \\\n") +
    ` \\\n    --title "Onionskin ${version}" --notes ${JSON.stringify(notes)}\n`,
);
console.log(
  "The updater reads\n" +
    `  https://github.com/${REPO_SLUG}/releases/latest/download/latest.json\n` +
    "which only resolves once the release is published and the repository is\n" +
    "reachable by the installed app.\n",
);
