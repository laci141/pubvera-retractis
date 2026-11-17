// Five small UI fixes in index.html, checked at the source.
//
// Run: node tools/ui_polish_test.js
//
//   U1 the hero emoji sits outside the gradient text: the h1 holds
//      span.hero-emoji (aria-hidden) and span.hero-title, and only
//      .hero-title clips the gradient to the text;
//   U2 form controls inherit the page font (one rule);
//   U3 one blur standard: no blur(18px) left, the 768px block also reduces
//      .errcard, every backdrop-filter keeps its -webkit- twin;
//   U4 text contrast: no #666/#777 text, #9a9a9a on .untitled, td.n and footer,
//      the purple text uses --color-text while borders keep --color;
//   U5 44px touch targets on .close-btn and .chip;
//   guards: reduced-motion block, .auth-btn rules and spin keyframes unchanged
//      in number.
// A piece that cannot be found is a FAIL, never a silent pass.
"use strict";
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");

let ran = 0, failed = 0;
function check(label, ok) { ran++; if (!ok) failed++; console.log((ok ? "PASS" : "FAIL") + "  " + label); }
const count = s => html.split(s).length - 1;

// Body of the first top-level rule "    <selector> {" (4-space indent), or "" if missing.
function rule(selector) {
  const open = "\n    " + selector + " {";
  const at = html.indexOf(open);
  if (at < 0) return "";
  const end = html.indexOf("}", at + open.length);
  return end < 0 ? "" : html.slice(at + open.length, end);
}

// U1
const h1 = (html.match(/<h1>[\s\S]*?<\/h1>/) || [""])[0];
check("U1 h1 has span.hero-emoji with aria-hidden=\"true\"",
  /<span class="hero-emoji" aria-hidden="true">[^<]+<\/span>/.test(h1));
check("U1 h1 has span.hero-title", /<span class="hero-title">Retractis<\/span>/.test(h1));
const heroH1 = rule(".hero h1");
check("U1 .hero h1 rule found, no background-clip and no text-fill-color",
  heroH1 !== "" && !heroH1.includes("background-clip") && !heroH1.includes("text-fill-color"));
const heroTitle = rule(".hero-title");
check("U1 .hero-title has background-clip: text (both) and -webkit-text-fill-color: transparent",
  heroTitle.includes("-webkit-background-clip: text;") && /[^-]background-clip: text;/.test(heroTitle) &&
  heroTitle.includes("-webkit-text-fill-color: transparent;"));

// U2
check("U2 exactly one font-family: inherit rule for controls (" +
  count("button, input, select, textarea { font-family: inherit; }") + ")",
  count("button, input, select, textarea { font-family: inherit; }") === 1);

// U3
check("U3 blur(18px) appears 0 times (" + count("blur(18px)") + ")", count("blur(18px)") === 0);
const mobileAt = html.indexOf("@media (max-width: 768px) {");
const mobileEnd = mobileAt < 0 ? -1 : html.indexOf("\n    }", mobileAt);
const mobile = mobileAt >= 0 && mobileEnd >= 0 ? html.slice(mobileAt, mobileEnd) : "";
check("U3 768px block sets blur(11px) on .glass-panel, .modal-content, .chip, .errcard",
  mobile.includes(".glass-panel, .modal-content, .chip, .errcard {\n        backdrop-filter: blur(11px);"));
const plain = (html.match(/(^|[^-])backdrop-filter:/g) || []).length;
const webkit = count("-webkit-backdrop-filter:");
check("U3 every backdrop-filter has its -webkit- twin (" + plain + "/" + webkit + ")", plain > 0 && plain === webkit);

// U4
check("U4 no color: #666 or #777 remains", !/color:\s*#(666|777)\b/.test(html));
check("U4 .untitled uses #9a9a9a", html.includes(".untitled { color: #9a9a9a;"));
check("U4 td.n uses #9a9a9a", html.includes("td.n { color: #9a9a9a;"));
check("U4 footer uses #9a9a9a", /color: #9a9a9a;/.test(rule("footer")));
check("U4 --color-text: #a78bfa exactly twice (" + count("--color-text: #a78bfa") + ")", count("--color-text: #a78bfa") === 2);
check("U4 .bento-label uses var(--color-text", html.includes(".bento-label {") && /\.bento-label \{[^}]*color: var\(--color-text/.test(html));
check("U4 .modal-header h2 uses var(--color-text", /\.modal-header h2 \{[^}]*color: var\(--color-text/.test(html));
check("U4 .bento-card.search border-left still uses var(--color)",
  /\.bento-card\.search\s+\{[^}]*--color: #7c3aed;[^}]*border-left: 4px solid var\(--color\);/.test(html));

// U5
const close = rule(".close-btn");
check("U5 .close-btn has min-width: 44px and min-height: 44px",
  close.includes("min-width: 44px;") && close.includes("min-height: 44px;"));
check("U5 .chip has min-height: 44px", rule(".chip").includes("min-height: 44px;"));

// Guards
check("G reduced-motion block once (" + count("@media (prefers-reduced-motion: reduce) {") + ")",
  count("@media (prefers-reduced-motion: reduce) {") === 1);
check("G .auth-btn { once (" + count("\n    .auth-btn {") + ")", count("\n    .auth-btn {") === 1);
check("G @keyframes spin once (" + count("@keyframes spin") + ")", count("@keyframes spin") === 1);

console.log((ran - failed) + "/" + ran + " passed");
if (failed) process.exit(1);
