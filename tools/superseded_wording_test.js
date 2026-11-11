// "Find Newer Research" says what it does (RET-005, RET-006).
//
// Run: node tools/superseded_wording_test.js
//
// The CLI's superseded command searches OpenAlex with the paper's title words,
// keeps works published since the paper's year and sorts them by citation
// count (retraction-checker superseded.go / fetchOpenAlexRelated). Nothing
// checks that a result replaces, corrects or answers the paper. The page used
// to promise exactly that: "Find what research replaced it" on the card and
// "newer research that supersedes it" in the meta description and the hero.
// This test pins the honest wording:
//   W1 no user-facing text claims that a result replaced or supersedes the paper;
//   W2 the card, the meta description and the hero say "same topic" and
//      "ranked by citations";
//   W3 the modal carries a note (#superseded-note) that names the method
//      (title words, since its year, citation count) and says the results are
//      not verified replacements or corrections;
//   W4 the dialog points aria-describedby at that note, so a screen reader
//      announces it with the title;
//   W5 the note is styled by a .modal-note rule whose text colour keeps at
//      least 4.5:1 contrast on the modal background (rgba(26,26,46,.9) over
//      the dark page, measured as #1a1a2e);
//   W6 the result line under the title says "related works since", not
//      "newer research since".
// A piece that cannot be found is a FAIL, never a silent pass.
"use strict";
const fs = require("fs");
const path = require("path");

const raw = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
// Comments are blanked so a phrase inside one cannot satisfy or break a check.
const html = raw.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, " "));

let ran = 0;
let failed = 0;
function check(label, ok, got) {
  ran++;
  if (!ok) failed++;
  console.log((ok ? "PASS" : "FAIL") + "  " + label + (ok || got === undefined ? "" : "  got " + JSON.stringify(got)));
}

// W1 — user-facing text only: strip <script> and <style> bodies first.
const visible = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
const promise = visible.match(/replaced it|replaces it|supersedes it|superseded by|what research replaced/i);
check("W1 no text promises a replacement", !promise, promise && promise[0]);

// W2
const card = (html.match(/<button[^>]*class="bento-card[^"]*superseded"[\s\S]*?<\/button>/) || [""])[0];
const desc = (card.match(/<span class="bento-desc">([^<]*)<\/span>/) || [])[1] || "";
check("W2 card description: same topic, ranked by citations", /same topic/i.test(desc) && /ranked by citations/i.test(desc), desc);
const metaDesc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
check("W2 meta description: same topic, ranked by citations", /same topic/i.test(metaDesc) && /ranked by citations/i.test(metaDesc), metaDesc);
const hero = (html.match(/<p>Check any DOI[^<]*<\/p>/) || [""])[0];
check("W2 hero text: same topic, ranked by citations", /same topic/i.test(hero) && /ranked by citations/i.test(hero), hero);

// W3
const modal = (html.match(/<div class="modal" id="modal-superseded">[\s\S]*?id="superseded-results"/) || [""])[0];
const note = (modal.match(/<p class="modal-note" id="superseded-note">([^<]*)<\/p>/) || [])[1] || "";
check("W3 note sits inside the superseded modal", note !== "", modal.slice(0, 80));
check("W3 note names the method", /title words/i.test(note) && /since its year/i.test(note) && /citation count/i.test(note), note);
check("W3 note says: not verified replacements or corrections", /not verified replacements or corrections/i.test(note), note);
const noteIdx = modal.indexOf('id="superseded-note"');
const btnIdx = modal.indexOf('id="superseded-btn"');
check("W3 note is read before the button", noteIdx > 0 && btnIdx > noteIdx, [noteIdx, btnIdx]);

// W4
const dialog = (modal.match(/<div class="modal-content"[^>]*>/) || [""])[0];
check("W4 dialog aria-describedby=superseded-note", /aria-describedby="superseded-note"/.test(dialog), dialog);

// W5
const rule = (html.match(/\.modal-note\s*\{([^}]*)\}/) || [])[1] || "";
const colorM = rule.match(/color:\s*#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
function lum(hex) {
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  const ch = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
let ratio = 0;
if (colorM) {
  const a = lum(colorM[1]), b = lum("1a1a2e");
  ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
check("W5 .modal-note colour contrast >= 4.5:1", ratio >= 4.5, ratio.toFixed(2));

// W6
check("W6 result line says related works since", /' &nbsp;related works since '/.test(html) && !/newer research since/.test(html));

console.log("\n" + (ran - failed) + "/" + ran + " passed");
process.exit(failed ? 1 : 0);
