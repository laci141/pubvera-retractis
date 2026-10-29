// Delegated data-action / data-enter / data-mirror listeners test (CSP phase 0).
//
// Run: node tools/delegated_actions_test.js
//
// index.html carries data-action="...", data-enter="..." and data-mirror="..."
// instead of inline on*= handlers; three named listeners in the classic script
// act on them. no_inline_handlers_test.js proves the handlers are gone; this
// proves the replacement works:
//   T4 each listener function is defined once and registered on document once;
//   T5 every data-action / data-enter value used in index.html has a branch in
//      its listener, and every branch is used (both directions);
//   T6 the real listener functions run in a vm sandbox with fake elements and
//      call the real function names with the old arguments.
// A listener that cannot be found is a FAIL, never a silent pass.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raw = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
// HTML comments are blanked character by character so line numbers still match.
const html = raw.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, " "));
const lineOf = i => html.slice(0, i).split("\n").length;

let ran = 0;
let failed = 0;
function check(label, ok) {
  ran++;
  if (!ok) failed++;
  console.log((ok ? "PASS" : "FAIL") + "  " + label);
}
const count = s => html.split(s).length - 1;

// A function runs from "function NAME(e) {" to the first "\n    }" after it;
// the opening must occur exactly once.
function cut(name) {
  const open = "function " + name + "(e) {";
  const n = count(open);
  if (n !== 1) return { found: n, code: "" };
  const at = html.indexOf(open);
  const end = html.indexOf("\n    }", at);
  if (end < 0) return { found: 1, code: "" };
  return { found: 1, code: html.slice(at, end + 6), line: lineOf(at) };
}

// ── T4: definitions and registrations ──
const fnOf = { click: "onActionClick", keydown: "onEnterKey", input: "onMirrorInput" };
const L = {};
for (const t of Object.keys(fnOf)) {
  L[t] = cut(fnOf[t]);
  check("T4 " + fnOf[t] + " defined exactly once (found " + L[t].found +
    (L[t].line ? ", L" + L[t].line : "") + ")", L[t].found === 1 && L[t].code !== "");
  const reg = "document.addEventListener('" + t + "', " + fnOf[t] + ");";
  check("T4 " + reg + " exactly once (found " + count(reg) + ")", count(reg) === 1);
}

// ── T5: used values vs handled branches ──
function usedValues(attr) {
  const used = new Map();
  const re = new RegExp(attr + "\\s*=\\s*\\\\?[\"']([^\"'\\\\]*)", "g");
  html.split("\n").forEach((ln, i) => {
    if (/^\s*\/\//.test(ln)) return;
    for (const m of ln.matchAll(re)) {
      if (!used.has(m[1])) used.set(m[1], []);
      used.get(m[1]).push(i + 1);
    }
  });
  return used;
}
function compare(label, code, attr) {
  const branches = [...new Set([...code.matchAll(/\ba === '([^']*)'/g)].map(m => m[1]))];
  const used = usedValues(attr);
  console.log("      " + label + " branches: " + (branches.join(", ") || "(none)"));
  console.log("      " + attr + " used: " +
    ([...used].map(([v, ls]) => v + " (L" + ls.join(",L") + ")").join(", ") || "(none)"));
  const missing = [...used.keys()].filter(v => !branches.includes(v));
  const dead = branches.filter(v => !used.has(v));
  check("T5 " + label + " has at least one branch (found " + branches.length + ")", branches.length > 0);
  check("T5 every " + attr + " has a branch (missing: " + (missing.join(", ") || "none") + ")", missing.length === 0);
  check("T5 every " + label + " branch is used (dead: " + (dead.join(", ") || "none") + ")", dead.length === 0);
}
compare("onActionClick", L.click.code, "data-action");
compare("onEnterKey", L.keydown.code, "data-enter");
const mirrors = [...usedValues("data-mirror").keys()].sort();
check("T5 data-mirror targets are search-limit-val, superseded-limit-val (found " + (mirrors.join(", ") || "none") + ")",
  JSON.stringify(mirrors) === JSON.stringify(["search-limit-val", "superseded-limit-val"]));

// ── T6: drive the real listeners in a vm sandbox (fresh sandbox per case) ──
function harness() {
  const calls = [];
  const els = {
    "search-limit-val": { textContent: "10" },
    "superseded-limit-val": { textContent: "10" },
  };
  const rec = name => (...args) => { calls.push(name + "(" + args.map(a => (a === undefined ? "undefined" : JSON.stringify(a))).join(",") + ")"); };
  const sb = {
    openModal: rec("openModal"), closeModal: rec("closeModal"),
    runCheck: rec("runCheck"), runSearch: rec("runSearch"), runSuperseded: rec("runSuperseded"),
    pubveraSignIn: rec("pubveraSignIn"),
    document: { getElementById: id => els[id] || null },
  };
  vm.createContext(sb);
  vm.runInContext(L.click.code + "\n" + L.keydown.code + "\n" + L.input.code, sb);
  // The click target is the element inside the button; closest() walks up to it.
  const click = el => sb.onActionClick({ target: { closest: s => (s === "[data-action]" ? el : null) } });
  const key = (k, dataset) => sb.onEnterKey({ key: k, target: { dataset } });
  const input = (dataset, value) => sb.onMirrorInput({ target: { dataset, value } });
  return { calls, els, click, key, input };
}
function tcase(label, fn, want) {
  let got = null, why = "";
  try { got = fn(harness()); } catch (e) { why = " (threw: " + e.message + ")"; }
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check("T6 " + label + why + (ok || why ? "" : " (got " + JSON.stringify(got) + ")"), ok);
}
const clickCase = (label, dataset, want) => tcase(label, h => { h.click({ dataset }); return h.calls; }, want);
const limits = h => [h.els["search-limit-val"].textContent, h.els["superseded-limit-val"].textContent];

clickCase("chip open-modal check + DOI", { action: "open-modal", modal: "check", arg: "10.1016/S0140-6736(97)11096-0" },
  ['openModal("check","10.1016/S0140-6736(97)11096-0")']);
clickCase("chip open-modal search + query", { action: "open-modal", modal: "search", arg: "CRISPR" },
  ['openModal("search","CRISPR")']);
clickCase("card open-modal superseded, no arg", { action: "open-modal", modal: "superseded" },
  ['openModal("superseded",undefined)']);
clickCase("close-modal search", { action: "close-modal", modal: "search" }, ['closeModal("search")']);
clickCase("run-check", { action: "run-check" }, ["runCheck()"]);
clickCase("run-search", { action: "run-search" }, ["runSearch()"]);
clickCase("run-superseded", { action: "run-superseded" }, ["runSuperseded()"]);
clickCase("sign-in", { action: "sign-in" }, ["pubveraSignIn()"]);
clickCase("unknown data-action does nothing", { action: "nope" }, []);
tcase("click outside any [data-action] does nothing", h => { h.click(null); return h.calls; }, []);
tcase("Enter on data-enter=run-check -> runCheck()", h => { h.key("Enter", { enter: "run-check" }); return h.calls; }, ["runCheck()"]);
tcase("Enter on data-enter=run-search -> runSearch()", h => { h.key("Enter", { enter: "run-search" }); return h.calls; }, ["runSearch()"]);
tcase("Enter on data-enter=run-superseded -> runSuperseded()", h => { h.key("Enter", { enter: "run-superseded" }); return h.calls; }, ["runSuperseded()"]);
tcase("other key on a data-enter input does nothing", h => { h.key("a", { enter: "run-check" }); return h.calls; }, []);
tcase("Enter without data-enter does nothing", h => { h.key("Enter", {}); return h.calls; }, []);
tcase("range input mirrors into search-limit-val", h => { h.input({ mirror: "search-limit-val" }, "17"); return limits(h); }, ["17", "10"]);
tcase("range input mirrors into superseded-limit-val", h => { h.input({ mirror: "superseded-limit-val" }, "23"); return limits(h); }, ["10", "23"]);
tcase("input without data-mirror changes nothing", h => { h.input({}, "99"); return limits(h).concat(h.calls.length); }, ["10", "10", 0]);

if (ran === 0) {
  console.error("FAIL: zero checks ran - refusing to pass silently");
  process.exit(1);
}
console.log((ran - failed) + "/" + ran + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
