// No inline style attributes test (CSP style S0).
//
// Run: node tools/no_inline_styles_test.js
//
// A Content-Security-Policy with style-src-attr 'none' blocks every inline
// style attribute, including ones inserted through innerHTML, so index.html
// must carry none, neither in markup nor in HTML built inside JS strings. The
// three modal colours, the small badges and the citation bar widths now come
// from stylesheet rules, a class and CSSOM (el.style.width), which the policy
// allows. Source check over the whole file (HTML comments blanked first):
//   S1 no style attribute anywhere, script strings included;
//   S2 no setAttribute('style' and no cssText;
//   S3 #modal-check / #modal-search / #modal-superseded set --color exactly;
//   S4 a .badge.badge-lg rule with font-size 0.85rem, padding 0.2rem 0.7rem;
//   S5 both runSuperseded badge strings carry badge-lg;
//   S6 the bar-chart string carries data-bar-width and applyBarWidths sets
//      style.width from getAttribute('data-bar-width');
//   S7 applyBarWidths runs in a vm: "37" -> 37%, "100" -> 100%, missing and
//      "abc" -> no width (the old width:NaN% was an ignored declaration);
//   S8 applyBarWidths is called after out.innerHTML in runSuperseded;
//   S9 the vm stub offers only querySelectorAll on the scoped root.
// A function that cannot be found is a FAIL, never a silent pass.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raw = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
if (!/<script\b/.test(raw) || !/<style\b/.test(raw)) {
  console.error("FAIL: no <script> or <style> found in index.html - refusing to pass silently");
  process.exit(1);
}
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
const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join("\n");
// Declarations of every rule whose selector list is exactly sel.
function decls(sel) {
  const out = [];
  // Each rule is "selector { body }"; the selector is the text after the
  // previous "}" (or start), trimmed, compared literally.
  for (const m of css.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
    if (m[1].trim() === sel) out.push(m[2]);
  }
  return out;
}
const norm = s => s.replace(/\s+/g, " ").trim();
function hasDecl(sel, prop, val) {
  return decls(sel).some(body => body.split(";").some(d => {
    const i = d.indexOf(":");
    return i > 0 && d.slice(0, i).trim() === prop && norm(d.slice(i + 1)) === val;
  }));
}

// ── S1: no style attribute (markup and script strings) ──
const attrs = [...html.matchAll(/\bstyle\s*=/g)];
check("S1 no style attribute in index.html (found " + attrs.length + ")", attrs.length === 0);
for (const m of attrs) console.log("      L" + lineOf(m.index) + ": " + html.slice(m.index, m.index + 40).split("\n")[0]);

// ── S2: no string style set from JS ──
const setStyle = [...html.matchAll(/setAttribute\s*\(\s*["'`]style/gi)].length;
const cssText = count("cssText");
check("S2 no setAttribute('style' (found " + setStyle + ") and no cssText (found " + cssText + ")", setStyle === 0 && cssText === 0);

// ── S3: modal colours from id rules ──
for (const [id, col] of [["modal-check", "#00d4ff"], ["modal-search", "#7c3aed"], ["modal-superseded", "#22c55e"]]) {
  check("S3 #" + id + " { --color: " + col + "; } (rules found " + decls("#" + id).length + ")", hasDecl("#" + id, "--color", col));
}

// ── S4: badge-lg rule ──
check("S4 .badge.badge-lg font-size 0.85rem", hasDecl(".badge.badge-lg", "font-size", "0.85rem"));
check("S4 .badge.badge-lg padding 0.2rem 0.7rem", hasDecl(".badge.badge-lg", "padding", "0.2rem 0.7rem"));

// ── S5: both badge strings carry badge-lg ──
check("S5 retracted badge is class=\"badge bad badge-lg\" (found " + count("<span class=\"badge bad badge-lg\">⚠ RETRACTED</span>") + ")",
  count("<span class=\"badge bad badge-lg\">⚠ RETRACTED</span>") === 1);
check("S5 not-retracted badge is class=\"badge ok badge-lg\" (found " + count("<span class=\"badge ok badge-lg\">✓ Not retracted</span>") + ")",
  count("<span class=\"badge ok badge-lg\">✓ Not retracted</span>") === 1);

// ── S6: data-bar-width and the CSSOM helper ──
const barStr = "'<div class=\"bar-track\"><div class=\"bar-chart\" data-bar-width=\"' + pct + '\"></div></div></div>'";
check("S6 bar-chart string carries data-bar-width (found " + count(barStr) + ")", count(barStr) === 1);
const open = "function applyBarWidths(root) {";
let fn = "";
if (count(open) === 1) {
  const at = html.indexOf(open);
  const end = html.indexOf("\n    }", at);
  if (end > 0) fn = html.slice(at, end + 6);
}
check("S6 applyBarWidths(root) defined exactly once (found " + count(open) + ")", fn !== "");
check("S6 applyBarWidths reads getAttribute('data-bar-width') and sets style.width",
  fn.includes("getAttribute('data-bar-width')") && /\.style\.width\s*=/.test(fn));

// ── S7 + S9: behaviour in a vm with a minimal stub ──
function el(v) {
  const attrs = v === undefined ? {} : { "data-bar-width": v };
  return { style: {}, getAttribute: n => (n in attrs ? attrs[n] : null) };
}
let res = null;
let sels = [];
try {
  const els = [el("37"), el("100"), el(undefined), el("abc")];
  // The root offers querySelectorAll and nothing else; no document exists.
  const root = { querySelectorAll: s => { sels.push(s); return els; } };
  const ctx = vm.createContext({ root, Number });
  vm.runInContext(fn + "\napplyBarWidths(root);", ctx);
  res = els.map(e => ("width" in e.style ? e.style.width : "(unset)"));
} catch (e) {
  console.log("      vm error: " + e.message);
}
const got = JSON.stringify(res);
check("S7 widths 37/100/missing/abc -> " + got, got === JSON.stringify(["37%", "100%", "(unset)", "(unset)"]));
check("S9 stub root needs only querySelectorAll, selector " + JSON.stringify(sels),
  res !== null && sels.length === 1 && sels[0] === ".bar-chart[data-bar-width]");

// ── S8: call comes after out.innerHTML = h inside runSuperseded ──
const rsAt = html.indexOf("async function runSuperseded() {");
const rsEnd = rsAt < 0 ? -1 : html.indexOf("\n    }", rsAt);
const body = rsAt < 0 || rsEnd < 0 ? "" : html.slice(rsAt, rsEnd);
const asg = body.indexOf("out.innerHTML = h;");
const call = body.indexOf("applyBarWidths(out);");
check("S8 applyBarWidths(out) after out.innerHTML = h in runSuperseded (assign @" + asg + ", call @" + call + ")",
  asg >= 0 && call > asg && body.indexOf(barStr) >= 0 && body.indexOf(barStr) < asg);

if (ran === 0) {
  console.error("FAIL: zero checks ran - refusing to pass silently");
  process.exit(1);
}
console.log((ran - failed) + "/" + ran + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
