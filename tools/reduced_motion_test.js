// Respect the OS "reduce motion" setting, but keep the loading spinner.
//
// Run: node tools/reduced_motion_test.js
//
// People who asked their OS to reduce motion still got smooth scrolling, the
// modal fade/slide, the results fade and the hover lift/scale. One
// @media (prefers-reduced-motion: reduce) block switches those off. The
// spinner is a status indicator ("still working") and stays animated.
// Source checks:
//   R1 exactly one reduced-motion block, after the 768px block, before </style>;
//   R2 it sets html { scroll-behavior: auto; };
//   R3 it stops the modal, modal-content and results animations;
//   R4 it turns every transition off with !important (the base rules use
//      transition: all ..., which a plain declaration would not beat on hover);
//   R5 it cancels the hover/active transforms of chip, bento-card and btn;
//   R6 guard: the block touches neither .loading nor spin, and the spinner
//      keyframes and animation still exist once each;
//   R7 guard: smooth scrolling, fadeIn and slideUp still exist once each
//      outside the block (motion stays for everyone else);
//   R8 guard: every backdrop-filter still has its -webkit- twin.
// A piece that cannot be found is a FAIL, never a silent pass.
"use strict";
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");

let ran = 0, failed = 0;
function check(label, ok) { ran++; if (!ok) failed++; console.log((ok ? "PASS" : "FAIL") + "  " + label); }
const count = s => html.split(s).length - 1;

const OPEN = "@media (prefers-reduced-motion: reduce) {";
const CLOSE = "\n    }";

// The 768px block and its closing brace (4-space indent, like every top-level rule).
const mobileAt = html.indexOf("@media (max-width: 768px) {");
const mobileEnd = mobileAt < 0 ? -1 : html.indexOf(CLOSE, mobileAt);
const styleEnd = html.indexOf("</style>");
check("R1 anchors found: 768px block (" + mobileAt + ") and </style> (" + styleEnd + ")", mobileAt >= 0 && mobileEnd >= 0 && styleEnd >= 0);

const rmAt = html.indexOf(OPEN);
const rmEnd = rmAt < 0 ? -1 : html.indexOf(CLOSE, rmAt);
const block = rmAt >= 0 && rmEnd >= 0 ? html.slice(rmAt, rmEnd + CLOSE.length) : "";
check("R1 exactly one prefers-reduced-motion: reduce block (" + count("prefers-reduced-motion") + ")",
  count("prefers-reduced-motion") === 1 && count(OPEN) === 1);
check("R1 placed after the 768px block and before </style>",
  rmAt >= 0 && mobileEnd >= 0 && styleEnd >= 0 && rmAt > mobileEnd && rmEnd < styleEnd);

check("R2 html { scroll-behavior: auto; } inside the block", block.includes("html { scroll-behavior: auto; }"));
check("R3 .modal, .modal-content, .results { animation: none; } inside the block",
  block.includes(".modal, .modal-content, .results { animation: none; }"));
check("R4 *, *::before, *::after { transition: none !important; } inside the block",
  block.includes("*, *::before, *::after { transition: none !important; }"));
check("R5 .chip:hover, .bento-card:hover, .btn:hover, .btn:active { transform: none; } inside the block",
  block.includes(".chip:hover, .bento-card:hover, .btn:hover, .btn:active { transform: none; }"));

check("R6 the block mentions neither .loading nor spin", !block.includes(".loading") && !block.includes("spin"));
check("R6 @keyframes spin once (" + count("@keyframes spin") + ")", count("@keyframes spin") === 1);
check("R6 animation: spin 0.6s linear infinite once (" + count("animation: spin 0.6s linear infinite") + ")",
  count("animation: spin 0.6s linear infinite") === 1);

check("R7 html { scroll-behavior: smooth; } once (" + count("html { scroll-behavior: smooth; }") + ")",
  count("html { scroll-behavior: smooth; }") === 1);
check("R7 @keyframes fadeIn once (" + count("@keyframes fadeIn") + ")", count("@keyframes fadeIn") === 1);
check("R7 @keyframes slideUp once (" + count("@keyframes slideUp") + ")", count("@keyframes slideUp") === 1);

const webkit = count("-webkit-backdrop-filter:");
const plain = (html.match(/(^|[^-])backdrop-filter:/gm) || []).length;
check("R8 -webkit-backdrop-filter (" + webkit + ") equals backdrop-filter (" + plain + ")", webkit > 0 && webkit === plain);

console.log("\n" + (ran - failed) + "/" + ran + " passed");
process.exit(ran === 0 || failed ? 1 : 0);
