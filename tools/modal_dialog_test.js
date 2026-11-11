// Modals are real dialogs: role, name, Tab trap, focus returns to the opener.
//
// Run: node tools/modal_dialog_test.js
//
// The three modals (check, search, superseded) were plain divs: a screen reader
// did not know a dialog had opened, the close button was announced as "times",
// Tab walked out of the dialog into the page behind it, and closing it dropped
// keyboard focus. Source checks (a real browser run is in the PR text):
//   D1 each .modal-content has role="dialog", aria-modal="true" and an
//      aria-labelledby that points at the id of its own <h2>;
//   D2 each close button is type="button" with aria-label="Close";
//   D3 modalFocusables, onModalTab and the saved opener exist once each, and
//      onModalTab is registered on every dialog (not on document);
//   D4 closeModal restores focus unless told not to, and openModal closes the
//      other dialogs WITHOUT restoring focus (second argument true);
//   D5 nothing hands closeModal straight to forEach: forEach passes the index
//      as the second argument, which here would switch focus restore off for
//      every dialog but the first (found in the browser run).
// A piece that cannot be found is a FAIL, never a silent pass.
"use strict";
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");

let ran = 0, failed = 0;
function check(label, ok) { ran++; if (!ok) failed++; console.log((ok ? "PASS" : "FAIL") + "  " + label); }
const count = s => html.split(s).length - 1;

for (const n of ["check", "search", "superseded"]) {
  const re = new RegExp('<div class="modal" id="modal-' + n + '">\\s*<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="(modal-' + n + '-title)"(?: aria-describedby="[^"]+")?>\\s*<div class="modal-header">\\s*<h2 id="([^"]+)">[^<]+</h2>\\s*<button ([^>]*)>');
  const m = html.match(re);
  check("D1 " + n + ": dialog role, aria-modal, labelledby points at its own h2", !!m && m[1] === m[2]);
  check("D2 " + n + ": close button type=button, aria-label=Close", !!m && /type="button"/.test(m[3]) && /aria-label="Close"/.test(m[3]) && new RegExp('data-modal="' + n + '"').test(m[3]));
}

check("D3 modalFocusables defined once", count("function modalFocusables(") === 1);
check("D3 onModalTab defined once", count("function onModalTab(e)") === 1);
check("D3 onModalTab registered on each dialog, not on document",
  count("addEventListener('keydown', onModalTab)") === 1 && !/document\.addEventListener\('keydown',\s*onModalTab/.test(html) &&
  /MODALS\.forEach\(name => document\.getElementById\('modal-' \+ name\)\.addEventListener\('keydown', onModalTab\)\)/.test(html));
check("D3 Tab trap wraps both ways",
  /e\.shiftKey && document\.activeElement === first\) \{ e\.preventDefault\(\); last\.focus\(\)/.test(html) &&
  /!e\.shiftKey && document\.activeElement === last\) \{ e\.preventDefault\(\); first\.focus\(\)/.test(html));
check("D3 one saved opener (let modalOpener)", count("let modalOpener = null;") === 1);

const cm = html.match(/function closeModal\(name, keepFocus\) \{[\s\S]*?\n    \}/);
check("D4 closeModal(name, keepFocus) found", !!cm);
check("D4 closeModal returns focus to the opener unless keepFocus", !!cm && /if \(!keepFocus && modalOpener && document\.contains\(modalOpener\)\) modalOpener\.focus\(\)/.test(cm[0]));
const om = html.match(/function openModal\(name, prefill\) \{[\s\S]*?\n    \}/);
check("D4 openModal closes the others with keepFocus=true", !!om && /MODALS\.forEach\(m => closeModal\(m, true\)\)/.test(om[0]));
check("D4 openModal remembers the opener (not one inside a dialog)", !!om && /modalOpener = opener/.test(om[0]) && /!opener\.closest\('\.modal'\)/.test(om[0]));

check("D5 no forEach(closeModal) (" + count("forEach(closeModal)") + ")", count("forEach(closeModal)") === 0);

console.log("\n" + (ran - failed) + "/" + ran + " passed");
process.exit(failed ? 1 : 0);
