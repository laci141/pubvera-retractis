// CalVer release workflow test.
//
// Run: node tools/release_workflow_test.js
//
// Every push to main gets a version YYYY.MM.DD.N, stamped into the binary, the
// image tag, the OCI label, a git tag and a GitHub Release. This static check
// reads .github/workflows/deploy.yml and the Dockerfile and asserts the pieces
// are wired together, and that only the main-only publish job can write
// (T1-T6 below).
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const yml = fs.readFileSync(path.join(root, ".github", "workflows", "deploy.yml"), "utf8").replace(/\r/g, "");
const docker = fs.readFileSync(path.join(root, "Dockerfile"), "utf8").replace(/\r/g, "");

let failed = 0;
function check(label, ok) {
  if (!ok) failed++;
  console.log((ok ? "PASS" : "FAIL") + "  " + label);
}

// Split the steps list into blocks, one per "- name:".
const steps = yml.split(/\n(?=\s*- name:)/);
function step(name) {
  return steps.find((s) => s.includes("- name: " + name)) || "";
}
// Every non-pull_request event on main (push and workflow_dispatch) is
// versioned: a workflow_dispatch run also pushes :latest, so it must not ship
// as "dev".
const NONPR_MAIN = /github\.event_name\s*!=\s*'pull_request'\s*&&\s*github\.ref\s*==\s*'refs\/heads\/main'/;

const ver = step("Compute version");
check("version step exists", ver !== "");
check("version step runs on non-PR events on main", NONPR_MAIN.test(ver));
check("version step uses date -u +%Y.%m.%d", ver.includes("date -u +%Y.%m.%d"));
check("version step uses git ls-remote --tags", ver.includes("git ls-remote --tags"));
check("version step writes GITHUB_OUTPUT", ver.includes("GITHUB_OUTPUT"));

const push = step("Build and export");
check("build passes APP_VERSION build-arg", /build-args:[\s\S]*APP_VERSION=/.test(push));
const tagLine = push.split("\n").find((l) => l.includes("steps.version.outputs.version") && l.includes("format(")) || "";
check("version image tag only on non-PR events on main", NONPR_MAIN.test(tagLine));

// The workflow is split into a read-only build job and a publish job that is
// the only one able to push or release. A job block runs from its "  <name>:"
// line to the next line indented two spaces or less; comments and blank lines
// do not end it.
const lines = yml.split("\n");
function block(start, indent) {
  const i = lines.findIndex((l) => start.test(l));
  if (i < 0) return { from: -1, to: -1, lines: [] };
  let j = i + 1;
  while (j < lines.length) {
    const l = lines[j];
    if (l.trim() !== "" && !l.trim().startsWith("#") && l.search(/\S/) <= indent) break;
    j++;
  }
  return { from: i, to: j, lines: lines.slice(i, j) };
}
// The non-comment, non-blank children of "<key>:" inside a block, trimmed.
function children(b, key, indent) {
  const k = b.lines.findIndex((l) => l === " ".repeat(indent) + key + ":");
  if (k < 0) return null;
  const out = [];
  for (const l of b.lines.slice(k + 1)) {
    if (l.trim() === "" || l.trim().startsWith("#")) continue;
    if (l.search(/\S/) <= indent) break;
    out.push(l.trim());
  }
  return out;
}
const top = { lines };
const buildJob = block(/^  build:\s*$/, 2);
const publishJob = block(/^  publish:\s*$/, 2);
const buildText = buildJob.lines.join("\n");
const publishText = publishJob.lines.join("\n");

const topPerms = children(top, "permissions", 0);
check("T1 top-level permissions is contents: read", JSON.stringify(topPerms) === JSON.stringify(["contents: read"]));

const buildPerms = children(buildJob, "permissions", 4);
check("T2 build job permissions are exactly contents: read (found " + JSON.stringify(buildPerms) + ")",
  JSON.stringify(buildPerms) === JSON.stringify(["contents: read"]));

const publishIf = (publishJob.lines.find((l) => /^    if:/.test(l)) || "");
check("T3 publish job if: requires refs/heads/main", publishIf.includes("github.ref == 'refs/heads/main'"));

function writeLinesOutsidePublish(re) {
  const hits = lines.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
  const outside = hits.filter((i) => i < publishJob.from || i >= publishJob.to);
  return { hits: hits.length, outside: outside.map((i) => i + 1) };
}
const pkg = writeLinesOutsidePublish(/^\s*packages:\s*write\b/);
const cnt = writeLinesOutsidePublish(/^\s*contents:\s*write\b/);
check("T4 packages: write only in the publish job (outside at lines " + JSON.stringify(pkg.outside) + ")",
  publishJob.from >= 0 && pkg.hits > 0 && pkg.outside.length === 0);
check("T4 contents: write only in the publish job (outside at lines " + JSON.stringify(cnt.outside) + ")",
  publishJob.from >= 0 && cnt.hits > 0 && cnt.outside.length === 0);

check("T5 build job has no docker/login-action", buildJob.from >= 0 && !buildText.includes("docker/login-action"));

const buildCheckout = buildText.split(/\n(?=\s*- name:)/).find((s) => s.includes("- name: Checkout")) || "";
check("T6 build Checkout has persist-credentials: false", /\n\s*persist-credentials:\s*false\s*(\n|$)/.test(buildCheckout));

const rel = step("Create GitHub release");
check("release step exists", rel !== "");
check("release step is in the publish job", publishText.includes("- name: Create GitHub release"));
check("release step runs gh release create --target", /gh release create[^\n]*--target/.test(rel));
const ghCalls = rel.split("\n").filter((l) => /\bgh release\b/.test(l));
check("every gh call in the release step names --repo (" + ghCalls.length + " calls)",
  ghCalls.length > 0 && ghCalls.every((l) => (l.match(/gh release/g) || []).length === (l.match(/--repo "\$GITHUB_REPOSITORY"/g) || []).length));
const load = step("Load and push");
check("release step comes after Load and push", load !== "" && rel !== "" && yml.indexOf(rel) > yml.indexOf(load));
check("publish job needs build", /^    needs:\s*build\s*$/m.test(publishText));
check("publish job if: allows workflow_dispatch, not only push", /github\.event_name\s*==\s*'workflow_dispatch'/.test(publishIf));

for (const [n, cond] of [
  ["version step if:", (ver.match(/if:[^\n]*/) || [""])[0]],
  ["version tag line", tagLine],
]) {
  check(n + " excludes pull_request and does not require event_name == 'push'",
    cond !== "" && /event_name\s*!=\s*'pull_request'/.test(cond) && !/event_name\s*==\s*'push'/.test(cond));
}

check("job has contents: write", /permissions:\s*\n\s*contents:\s*write/.test(yml));
check("concurrency group exists", /concurrency:\s*\n\s*group:/.test(yml));
check("cancel-in-progress is not true", !/cancel-in-progress:\s*true/.test(yml));

check("Dockerfile has ARG APP_VERSION=dev", docker.includes("ARG APP_VERSION=dev"));
check("Dockerfile ldflags set -X main.version=", docker.includes("-X main.version="));
check("Dockerfile has org.opencontainers.image.version", docker.includes("org.opencontainers.image.version"));

if (failed) {
  console.error(failed + " check(s) failed");
  process.exit(1);
}
console.log("all release workflow checks pass");
