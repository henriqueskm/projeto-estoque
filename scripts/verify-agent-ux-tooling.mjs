// Local, read-only source contracts. No browser, network, secrets or updater.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = "caae861406882ace930c45f274705713c79a2509";
const read = (file) => readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n");
const manifest = JSON.parse(read(".agents/skills/ux-tooling-manifest.json"));
const expected = [
  "emil-design-eng", "review-animations", "improve-animations",
  "find-animation-opportunities", "mobile-native", "break-ui",
  "transitions-dev", "transitions-polish", "playwright-cli",
];

function filesWithin(directory, relative = "") {
  return readdirSync(path.join(root, directory, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.posix.join(relative, entry.name);
      assert(!entry.isSymbolicLink(), `Unexpected symlink: ${file}`);
      return entry.isDirectory() ? filesWithin(directory, file) : [file];
    }).sort();
}

function frontmatter(source, name) {
  const match = source.match(/^---\n([\s\S]+?)\n---\n/);
  assert(match, `Missing frontmatter: ${name}`);
  // These vendored skills use plain scalar name/description, not YAML blocks.
  assert.equal(match[1].match(/^name: (.+)$/m)?.[1], name);
  const description = match[1].match(/^description: (.+)$/m)?.[1];
  assert(description && description.length <= 1024, `Invalid description: ${name}`);
  assert(!/[<>]/.test(description), `Unsafe description: ${name}`);
  assert(/^[a-z0-9-]{1,64}$/.test(name));
}

test("manifest includes only the nine requested upstream skills", () => {
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.skills.map((entry) => entry.name), expected);
});

for (const skill of manifest.skills) {
  test(`${skill.name}: metadata, payload hash, local links and license`, () => {
    const directory = `.agents/skills/${skill.name}`;
    const files = filesWithin(directory);
    frontmatter(read(`${directory}/SKILL.md`), skill.name);
    assert.equal(files.length, skill.fileCount);
    assert(/^[a-f0-9]{40}$/.test(skill.revision));
    assert(["emilkowalski/skills", "Jakubantalik/transitions.dev", "microsoft/playwright"].includes(skill.source));
    const hash = createHash("sha256");
    for (const file of files) {
      assert([".md", ".css", ".txt"].includes(path.extname(file)), `Unexpected executable/payload: ${file}`);
      const absolute = path.join(root, directory, file);
      assert(lstatSync(absolute).isFile());
      const contents = read(`${directory}/${file}`);
      hash.update(`${file}\n${contents}\n`);
      if (file.endsWith(".md")) {
        // Example snapshots inside fenced code are not installed references.
        const prose = contents.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");
        for (const link of prose.matchAll(/\]\(([^\s)]+)\)/g)) {
          if (/^(https?:|mailto:|#)/.test(link[1])) continue;
          // Screenshot/example artifact links are intentionally not vendored.
          if (!/\.(md|txt)(#.*)?$/.test(link[1])) continue;
          const target = path.resolve(path.dirname(absolute), link[1].split("#")[0]);
          assert(target.startsWith(path.join(root, ".agents/skills") + path.sep), `Link escapes skills: ${link[1]}`);
          assert(existsSync(target), `Missing local reference: ${file} -> ${link[1]}`);
        }
      }
    }
    assert.equal(hash.digest("hex"), skill.sha256, "Vendored content changed: review upstream/patches before updating manifest");
    assert(read(`${directory}/LICENSE.txt`).includes("License"));
  });
}

test("Builder preserves previous instructions and routes tools conditionally", () => {
  const file = ".agents/skills/nk-builder/SKILL.md";
  const builder = read(file);
  frontmatter(builder, "nk-builder");
  const previous = execFileSync("git", ["show", `${base}:${file}`], { cwd: root, encoding: "utf8" }).replaceAll("\r\n", "\n");
  assert(builder.startsWith(previous), "Existing Builder rules must remain intact");
  const tooling = builder.split("## UI/UX Tooling")[1];
  assert(tooling);
  for (const name of expected) assert(tooling.includes(name), `Missing routing: ${name}`);
  for (const rule of ["Sem UI", "UI relevante", "Motion já aprovado", "Mobile UX", "read-only", "Nenhuma ferramenta autoriza merge ou operação remota", "não fazer merge"]) {
    assert(tooling.includes(rule), `Missing Builder rule: ${rule}`);
  }
  const fallback = ".agents/skills/pr-pipeline-nk/SKILL.md";
  const trackedFallback = execFileSync("git", ["ls-tree", "--name-only", base, "--", fallback], { cwd: root, encoding: "utf8" }).trim();
  // The supplied main does not track the primary checkout's local fallback.
  if (trackedFallback) {
    assert.equal(read(fallback), execFileSync("git", ["show", `${base}:${fallback}`], { cwd: root, encoding: "utf8" }).replaceAll("\r\n", "\n"));
  } else {
    assert(!existsSync(path.join(root, fallback)), "Do not introduce/change the local fallback in this PR");
  }
});

test("CLI is pinned dev-only and existing app dependencies are unchanged", () => {
  const pkg = JSON.parse(read("package.json"));
  const original = JSON.parse(execFileSync("git", ["show", `${base}:package.json`], { cwd: root, encoding: "utf8" }));
  assert.deepEqual(pkg.dependencies, original.dependencies);
  assert.deepEqual(pkg.scripts, original.scripts);
  assert.deepEqual(pkg.devDependencies, { ...original.devDependencies, "@playwright/cli": "0.1.22" });
  const lock = JSON.parse(read("package-lock.json"));
  const previousLock = JSON.parse(execFileSync("git", ["show", `${base}:package-lock.json`], { cwd: root, encoding: "utf8" }));
  for (const [file, entry] of Object.entries(previousLock.packages)) {
    if (file) assert.deepEqual(lock.packages[file], entry, `Unrelated lockfile change: ${file}`);
  }
  assert.deepEqual(Object.keys(lock.packages).filter((file) => !previousLock.packages[file]).sort(), [
    "node_modules/@playwright/cli", "node_modules/playwright", "node_modules/playwright-core",
  ]);
  const pinned = lock.packages["node_modules/@playwright/cli"];
  assert.equal(pinned.version, "0.1.22");
  assert.equal(pinned.dev, true);
  assert(pinned.integrity?.startsWith("sha512-"));
});

test("browser artifacts are ignored and policy never grants mutation authority", () => {
  const directories = [".playwright", ".playwright-cli", "artifacts/agent-ux", "playwright-report", "test-results"];
  for (const directory of directories) {
    const file = `${directory}/nk-tooling-check-placeholder`;
    assert.equal(execFileSync("git", ["check-ignore", file], { cwd: root, encoding: "utf8" }).trim(), file);
  }
  const docs = read("docs/AGENT_UX_TOOLING.md");
  for (const text of ["320×800", "375×812", "768×1024", "1440×900", "prefers-reduced-motion", "Não mascarar latência", "Instant Navigation", "Nunca confirmar automaticamente", "Workspace State", "Back/Forward", "PR #80"]) assert(docs.includes(text));
});
