// The runtime stage upgrades zlib and OpenSSL by name.
//
// Run: node tools/dockerfile_apk_upgrade_test.js [path/to/Dockerfile]
//
// Before: the final stage had only "apk add", so the base image's vulnerable
// zlib (CVE-2026-4738, fixed in 1.4-r0) and libcrypto3/libssl3 (fixed in
// 3.5.9-r1) shipped as-is. Checks on the final stage (after the last FROM,
// comment lines skipped):
//   U1 exactly one line contains "apk upgrade";
//   U2 it carries --no-cache, zlib, libcrypto3 and libssl3;
//   U3 no bare "apk upgrade" (every occurrence is followed by a package name);
//   U4 the upgrade line comes before the USER line.
// A piece that cannot be found is a FAIL, never a silent pass.
"use strict";
const fs = require("fs");
const path = require("path");
const file = process.argv[2] || path.join(__dirname, "..", "Dockerfile");
let raw = fs.readFileSync(file, "utf8");
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
const text = raw.split("\r\n").join("\n");
let ran = 0, failed = 0;
function check(label, ok) { ran++; if (!ok) failed++; console.log((ok ? "PASS" : "FAIL") + "  " + label); }

const lines = text.split("\n");
let lastFrom = -1;
lines.forEach((l, i) => { if (l.trim().toUpperCase().startsWith("FROM ")) lastFrom = i; });
check("F0 a FROM line exists", lastFrom >= 0);
const stage = lines.slice(lastFrom + 1).filter(l => !l.trim().startsWith("#"));

const up = stage.filter(l => l.includes("apk upgrade"));
check("U1 exactly one line contains apk upgrade (found " + up.length + ")", up.length === 1);
const line = up[0] || "";
for (const p of ["--no-cache", "zlib", "libcrypto3", "libssl3"]) {
  check("U2 the upgrade line contains " + p, line.includes(p));
}

// U3: the words after each "apk upgrade" (flags skipped) must start with a package name.
let bare = false;
for (const l of up) {
  const parts = l.split("apk upgrade").slice(1);
  for (const rest of parts) {
    const words = rest.split(" ").filter(w => w !== "");
    let named = false;
    for (const w of words) {
      if (w.startsWith("-")) continue;
      named = !["&&", "||", ";", "&"].includes(w) && !w.startsWith(";");
      break;
    }
    if (!named) bare = true;
  }
}
check("U3 no bare apk upgrade without a package name", up.length > 0 && !bare);

const upIdx = stage.findIndex(l => l.includes("apk upgrade"));
const userIdx = stage.findIndex(l => l.trim().toUpperCase().startsWith("USER "));
check("U4 a USER line exists in the final stage", userIdx >= 0);
check("U4 the upgrade line comes before USER", upIdx >= 0 && userIdx >= 0 && upIdx < userIdx);

console.log(ran + " checks, " + failed + " failed");
if (failed) {
  console.error(failed + " check(s) failed");
  process.exit(1);
}
console.log("all Dockerfile apk upgrade checks pass");
