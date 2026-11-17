// An open modal locks the page behind it (CSS only), checked at the source.
//
// Run: node tools/scroll_lock_test.js
//
//   L1 exactly one html:has(.modal.active) rule with overflow: hidden and
//      scrollbar-gutter: stable;
//   L2 exactly one .modal, .modal-content overscroll-behavior: contain rule;
//   L3 both rules sit inside <style> and before the first 768px @media block;
//   L4 .modal.active { display: flex; } still exists exactly once;
//   guards: reduced-motion block once, every backdrop-filter keeps its
//      -webkit- twin, openModal and closeModal declared once each (no JS change).
// A piece that cannot be found is a FAIL, never a silent pass.
"use strict";
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");

let ran = 0, failed = 0;
function check(label, ok) { ran++; if (!ok) failed++; console.log((ok ? "PASS" : "FAIL") + "  " + label); }
const count = s => html.split(s).length - 1;

const LOCK = "html:has(.modal.active) { overflow: hidden; scrollbar-gutter: stable; }";
const CONTAIN = ".modal, .modal-content { overscroll-behavior: contain; }";

// L1, L2
check("L1 exactly one html:has lock rule (" + count(LOCK) + ")", count(LOCK) === 1);
check("L2 exactly one overscroll contain rule (" + count(CONTAIN) + ")", count(CONTAIN) === 1);

// L3
const styleAt = html.indexOf("<style");
const styleEnd = html.indexOf("</style>");
const mediaAt = html.indexOf("@media (max-width: 768px) {");
// Located by selector, so a changed declaration fails L1/L2 only, not L3.
const lockAt = html.indexOf("\n    html:has(.modal.active) {");
const containAt = html.indexOf("\n    .modal, .modal-content {");
const inTop = at => at >= 0 && styleAt >= 0 && mediaAt >= 0 && at > styleAt && at < mediaAt && mediaAt < styleEnd;
check("L3 both rules inside <style> and before the first 768px @media block",
  inTop(lockAt) && inTop(containAt));

// L4
check("L4 .modal.active { display: flex; } once (" + count(".modal.active { display: flex; }") + ")",
  count(".modal.active { display: flex; }") === 1);

// Guards
check("G reduced-motion block once (" + count("@media (prefers-reduced-motion: reduce) {") + ")",
  count("@media (prefers-reduced-motion: reduce) {") === 1);
const plain = (html.match(/(^|[^-])backdrop-filter:/g) || []).length;
const webkit = count("-webkit-backdrop-filter:");
check("G every backdrop-filter has its -webkit- twin (" + plain + "/" + webkit + ")", plain > 0 && plain === webkit);
const scripts = (html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) || []).join("\n");
const decl = n => (scripts.match(new RegExp("function " + n + "\\s*\\(", "g")) || []).length;
check("G function openModal declared once in scripts (" + decl("openModal") + ")", decl("openModal") === 1);
check("G function closeModal declared once in scripts (" + decl("closeModal") + ")", decl("closeModal") === 1);

console.log((ran - failed) + "/" + ran + " passed");
if (failed) process.exit(1);
