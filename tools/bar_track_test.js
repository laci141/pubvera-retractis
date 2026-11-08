// Bar track test (B1-B3): citation bars are a fixed .bar-track with a .bar-chart
// fill inside, so the fill's CSSOM width (data-bar-width %) shows the value.
//
// Run: node tools/bar_track_test.js
//
// CSS-source check: index.html's <style> block is read as text and comments are
// dropped. This is NOT a layout test: rendered widths are verified with the
// Playwright script retractis-bar-measure.mjs.
"use strict";
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");

let ran = 0;
let failed = 0;
function check(label, ok) {
  ran++;
  if (!ok) failed++;
  console.log((ok ? "PASS" : "FAIL") + "  " + label);
}
function refuse(what) {
  console.error("FAIL: " + what + " not found in index.html - refusing to pass silently");
  process.exit(1);
}

const styleOpen = html.match(/<style\b[^>]*>/);
const styleStart = styleOpen ? styleOpen.index : -1;
const styleEnd = html.indexOf("</style>");
if (styleStart < 0 || styleEnd < styleStart) refuse("the <style> block");
const style = html.slice(styleStart + styleOpen[0].length, styleEnd).replace(/\/\*[^]*?\*\//g, "");

// Bodies of every rule whose selector is exactly sel, whitespace removed.
function rules(sel) {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("(^|[}\\s])" + esc + "\\s*\\{([^}]*)\\}", "g");
  const out = [];
  let m;
  while ((m = re.exec(style))) out.push(m[2].replace(/\s+/g, ""));
  return out;
}
function has(body, decl) { return (";" + body + ";").indexOf(";" + decl + ";") >= 0; }

const track = rules(".bar-track");
const t = track[0] || "";
check("B1 exactly one .bar-track rule (found " + track.length + ") with max-width:150px and overflow:hidden (\"" + t + "\")",
  track.length === 1 && has(t, "max-width:150px") && has(t, "overflow:hidden"));

const chart = rules(".bar-chart");
const c = chart[0] || "";
check("B2 exactly one .bar-chart rule (found " + chart.length + ") without flex:/max-width, with width:0 and height:100% (\"" + c + "\")",
  chart.length === 1 && !/(^|;)flex:/.test(c) && c.indexOf("max-width") < 0 && has(c, "width:0") && has(c, "height:100%"));

const nested = "'<div class=\"bar-track\"><div class=\"bar-chart\" data-bar-width=\"' + pct + '\"></div></div></div>'";
const n = html.split(nested).length - 1;
check("B3 bar string has bar-chart inside bar-track exactly once (found " + n + ")", n === 1);

if (ran === 0) {
  console.error("FAIL: zero checks ran - refusing to pass silently");
  process.exit(1);
}
console.log((ran - failed) + "/" + ran + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
