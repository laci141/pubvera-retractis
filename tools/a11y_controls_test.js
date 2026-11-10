// Slider labels and keyboard-operable sort headers.
//
// Run: node tools/a11y_controls_test.js
//
// Before: the two range sliders sat in a <label> with no "for", so a screen
// reader announced "slider" with no name; and sorting was a click handler on
// <th>, which Tab never reaches and Enter/Space never activate. Source checks
// (a real Chromium run with Tab, Enter and Space is in the PR text):
//   L1 each <label> carries for="<slider id>" and that id exists once;
//   H1 both generated tables use sortHead(), and no raw <th> is built by hand;
//   H2 sortHead() makes <th scope="col"> holding <button type="button" class="sort-btn">;
//   H3 the click handler listens for .sort-btn and sets aria-sort ascending/descending
//      and clears it on the other headers;
//   H4 data-dir is kept (domView and the exports read it);
//   C1 the old "th { cursor: pointer }" rule is gone, .sort-btn and its
//      :focus-visible rule exist, and the glyph has an empty-text alternative.
// A piece that cannot be found is a FAIL, never a silent pass.
"use strict";
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");
let ran = 0, failed = 0;
function check(label, ok) { ran++; if (!ok) failed++; console.log((ok ? "PASS" : "FAIL") + "  " + label); }
const count = s => html.split(s).length - 1;

for (const [id, mirror] of [["search-limit", "search-limit-val"], ["superseded-limit", "superseded-limit-val"]]) {
  check("L1 label for=" + id, count('<label for="' + id + '">') === 1);
  check("L1 slider id=" + id + " exists once, type range", count('id="' + id + '"') === 1 && new RegExp('<input type="range" id="' + id + '"[^>]*data-mirror="' + mirror + '"').test(html));
}
check("L1 no label without for wraps a limit-val", !/<label>[^<]*<span class="limit-val"/.test(html));

check("H1 sortHead defined once", count("function sortHead(labels)") === 1);
check("H1 both tables call sortHead (got " + count("+ sortHead([") + ")", count("+ sortHead([") === 2);
check("H1 search headers", html.includes("sortHead(['#', 'Title', 'Year', 'DOI'])"));
check("H1 related headers", html.includes("sortHead(['#', 'Related work', 'Year', 'Citations'])"));
check("H1 no hand-built <th> left in the script", !/'<tr><th>/.test(html) && !/<th>#<\/th>/.test(html));
check("H2 th scope=col with a type=button .sort-btn", html.includes(`'<th scope="col"><button type="button" class="sort-btn">' + esc(l) + '</button></th>'`));
check("H3 handler keyed on .sort-btn", html.includes("e.target.closest('.sort-btn')") && !html.includes("e.target.closest('th');\n      if (!th || !th.closest('.results')) return;"));
check("H3 aria-sort set", html.includes("th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending')"));
check("H3 aria-sort cleared on the others", html.includes("cell.removeAttribute('aria-sort')"));
check("H4 data-dir still set and read", html.includes("th.dataset.dir = dir;") && html.includes("table.querySelector('th[data-dir]')"));
check("C1 old th cursor rule gone", !/\n\s*th \{ cursor: pointer;/.test(html));
check("C1 .sort-btn and :focus-visible rules", /\.sort-btn \{[^}]*cursor: pointer/.test(html) && html.includes(".sort-btn:focus-visible { outline:"));
check("C1 glyph alternative empty (3 rules)", count('/ ""') >= 3 && /content: " ⇅" \/ ""/.test(html));

console.log("\n" + (ran - failed) + "/" + ran + " passed");
process.exit(failed ? 1 : 0);
