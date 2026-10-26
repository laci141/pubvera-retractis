// CalVer release workflow test.
//
// Run: node tools/release_workflow_test.js
//
// Every push to main gets a version YYYY.MM.DD.N, stamped into the binary, the
// image tag, the OCI label, a git tag and a GitHub Release. This static check
// reads .github/workflows/deploy.yml and the Dockerfile and asserts the pieces
// are wired together.
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

const push = step("Build and push");
check("build passes APP_VERSION build-arg", /build-args:[\s\S]*APP_VERSION=/.test(push));
const tagLine = push.split("\n").find((l) => l.includes("steps.version.outputs.version") && l.includes("format(")) || "";
check("version image tag only on non-PR events on main", NONPR_MAIN.test(tagLine));

const rel = step("Create GitHub release");
check("release step exists", rel !== "");
check("release step runs on non-PR events on main", NONPR_MAIN.test(rel));
check("release step runs gh release create --target", /gh release create[^\n]*--target/.test(rel));
check("release step comes after Build and push", push !== "" && rel !== "" && yml.indexOf(rel) > yml.indexOf(push));

for (const [n, cond] of [
  ["version step if:", (ver.match(/if:[^\n]*/) || [""])[0]],
  ["version tag line", tagLine],
  ["release step if:", (rel.match(/if:[^\n]*/) || [""])[0]],
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
