// Bento cards are native buttons (accessibility: role, Tab, Enter, Space).
//
// Run: node tools/bento_cards_test.js
//
// The three home-page cards (Check a Paper, Search Works, Find Newer Research)
// used to be <div data-action="open-modal">: no role, not reachable with Tab,
// not operable with Enter or Space. They are <button type="button"> now, and
// the delegated click listener (data-action) is unchanged, so a click, Enter
// and Space all reach it. This test pins the markup and the CSS that keeps the
// buttons looking like the old cards:
//   B1 exactly three .bento-card elements, each an opening <button type="button">;
//   B2 no <div class="bento-card" is left;
//   B3 the three buttons open the modals check, search and superseded;
//   B4 the cards' content is phrasing content (no <div> inside the section);
//   B5 each card has icon, label and description, and the emoji icon is
//      aria-hidden so the accessible name is the label and description only;
//   B6 the .bento-card rule resets the button defaults (font, which carries
//      line-height, letter-spacing, color, margin) so the card renders like the old div;
//   B7 a visible :focus-visible outline exists (a button without one is
//      focusable but invisible to a keyboard user).
// A rule or section that cannot be found is a FAIL, never a silent pass.
"use strict";
const fs = require("fs");
const path = require("path");

const raw = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
const html = raw.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, " "));

let ran = 0;
let failed = 0;
function check(label, ok) {
  ran++;
  if (!ok) failed++;
  console.log((ok ? "PASS" : "FAIL") + "  " + label);
}

const start = html.indexOf('<section class="bento-grid">');
const end = start < 0 ? -1 : html.indexOf("</section>", start);
check("section.bento-grid found once", start >= 0 && html.indexOf('<section class="bento-grid">', start + 1) < 0 && end > start);
const grid = start >= 0 && end > start ? html.slice(start, end) : "";

// Every opening tag that carries the class bento-card, and its body up to the
// next card or the end of the section.
const openTags = grid.match(/<[a-z]+\s[^>]*class="bento-card[^"]*"[^>]*>/g) || [];
check("B1 three .bento-card elements (got " + openTags.length + ")", openTags.length === 3);
check("B1 every card opens as <button type=\"button\"", openTags.length === 3 && openTags.every(t => /^<button\s+type="button"\s/.test(t) || /^<button\s[^>]*type="button"/.test(t)));
check("B2 no <div class=\"bento-card\" left", !/<div\s[^>]*class="bento-card/.test(html));

const modals = openTags.map(t => (t.match(/data-modal="([a-z]+)"/) || [])[1]);
const acts = openTags.map(t => (t.match(/data-action="([a-z-]+)"/) || [])[1]);
check("B3 all three open-modal (got " + acts.join(",") + ")", acts.length === 3 && acts.every(a => a === "open-modal"));
check("B3 modals check, search, superseded (got " + modals.join(",") + ")", modals.join(",") === "check,search,superseded");

check("B4 no <div> inside the bento section", grid !== "" && !/<div[\s>]/.test(grid));
const icons = grid.match(/<span class="bento-icon" aria-hidden="true">/g) || [];
const labels = grid.match(/<span class="bento-label">/g) || [];
const descs = grid.match(/<span class="bento-desc">/g) || [];
check("B5 three aria-hidden icons (got " + icons.length + ")", icons.length === 3);
check("B5 three labels (got " + labels.length + ") and three descriptions (got " + descs.length + ")", labels.length === 3 && descs.length === 3);
check("B5 three closing </button> in the section", (grid.match(/<\/button>/g) || []).length === 3);

function rule(sel) {
  const re = new RegExp("(^|\\n)\\s*" + sel.replace(/[.:\-]/g, "\\$&") + "\\s*\\{([^}]*)\\}");
  const m = html.match(re);
  return m ? m[2] : null;
}
const base = rule(".bento-card");
check("B6 .bento-card rule found", base !== null);
check("B6 font: inherit (family, size, line-height)", base !== null && /(^|[;\s])font:\s*inherit/.test(base));
check("B6 letter-spacing: inherit", base !== null && /letter-spacing:\s*inherit/.test(base));
check("B6 color: inherit", base !== null && /(^|[;\s])color:\s*inherit/.test(base));
check("B6 margin: 0", base !== null && /margin:\s*0\s*;/.test(base));

const focus = rule(".bento-card:focus-visible");
check("B7 .bento-card:focus-visible rule found", focus !== null);
check("B7 it draws an outline (not none)", focus !== null && /outline:\s*\d+px\s+solid/.test(focus));

console.log("\n" + (ran - failed) + "/" + ran + " passed");
process.exit(failed ? 1 : 0);
