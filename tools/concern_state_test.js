// Expression of concern is its own state, never "RETRACTED" (audit RET-001).
//
// Run: node tools/concern_state_test.js
//
// The CLI pinned until 2026-11 put expression_of_concern in its retraction
// list, so a paper with only an editorial concern came back retracted=true and
// the check card said "RETRACTED". The current CLI (Dockerfile pin 0d3fe99)
// sends retracted and expression_of_concern as two fields, and both can be
// true. The page must show what the CLI says, no more:
//   S1 verdictBadges: retracted -> RETRACTED; concern only -> EXPRESSION OF
//      CONCERN and no RETRACTED; both -> both badges; neither -> "No
//      retraction signal found" and never a bare "Not retracted" (RET-006);
//   S2 a verdict carrying an "error" field is not drawn as a verdict;
//   S3 checkExportRow keeps the concern in its own columns: a concern-only
//      paper exports Retracted=No with empty retraction columns and the
//      concern date and notice DOI;
//   S4 concernNotice (Works search) finds an expression_of_concern in
//      updated-by, ignores update-to, and the retraction regex still does not
//      match it;
//   S5 toBibTeX notes a concern-only row as EXPRESSION OF CONCERN, not as
//      RETRACTED;
//   S6 the "Not retracted" wording is gone from the page (check and
//      superseded cards).
// Functions are pulled from index.html and run in a vm sandbox, so this tests
// the shipped code, not a copy. A function that cannot be found is a FAIL.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/\r\n/g, "\n");

let ran = 0, failed = 0;
function check(label, ok) { ran++; if (!ok) failed++; console.log((ok ? "PASS" : "FAIL") + "  " + label); }

function fn(name) {
  const start = html.indexOf("function " + name + "(");
  if (start < 0) return "";
  const open = html.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}" && --depth === 0) return html.slice(start, i + 1);
  }
  return "";
}

const names = ["esc", "toYear", "bibEsc", "bibFamilyName", "bibTitleWord", "bibKey", "toBibTeX", "verdictBadges", "checkExportRow", "concernNotice"];
const src = {};
for (const n of names) { src[n] = fn(n); check(n + " found", src[n] !== ""); }

const box = { decodeEntities: s => String(s) };
vm.createContext(box);
try { vm.runInContext(names.map(n => src[n]).join("\n") + "\n;this.api = {" + names.join(",") + "};", box); }
catch (e) { console.log("FAIL  sandbox: " + e.message); failed++; }
const api = box.api || {};
const call = (n, ...a) => { try { return api[n](...a); } catch (e) { return "THREW " + e.message; } };

// S1
const bRet = String(call("verdictBadges", { retracted: true }));
const bEoc = String(call("verdictBadges", { retracted: false, expression_of_concern: true }));
const bBoth = String(call("verdictBadges", { retracted: true, expression_of_concern: true }));
const bNone = String(call("verdictBadges", { retracted: false }));
check("S1 retracted -> RETRACTED", /RETRACTED/.test(bRet) && !/CONCERN/.test(bRet));
check("S1 concern only -> EXPRESSION OF CONCERN, no RETRACTED", /EXPRESSION OF CONCERN/.test(bEoc) && !/RETRACTED/.test(bEoc));
check("S1 both -> both badges", /RETRACTED/.test(bBoth) && /EXPRESSION OF CONCERN/.test(bBoth));
check("S1 neither -> No retraction signal found", /No retraction signal found/.test(bNone) && !/RETRACTED|CONCERN/.test(bNone));

// S2
check("S2 an error verdict throws instead of drawing a badge", /^THREW The lookup did not complete/.test(String(call("verdictBadges", { retracted: false, error: "GET /works/x returned HTTP 404: body" }))));

// S3
const eRow = call("checkExportRow", {
  doi: "10.1/eoc", title: "T", published: "2020-01-02", retracted: false, expression_of_concern: true,
  update_type: "expression_of_concern", date: "2021-05-06", notice_doi: "10.1/eoc.n",
  concern_date: "2021-05-06", concern_notice_doi: "10.1/eoc.n", signals: ["crossref-update:expression_of_concern"]
}, "10.1/eoc", "T") || {};
check("S3 concern-only row: Retracted=No, retraction columns empty",
  eRow.Retracted === "No" && eRow["Retraction type"] === "" && eRow["Retraction date"] === "" && eRow["Retraction notice DOI"] === "");
check("S3 concern-only row: Expression of concern=Yes with date and notice DOI",
  eRow["Expression of concern"] === "Yes" && eRow["Concern date"] === "2021-05-06" && eRow["Concern notice DOI"] === "10.1/eoc.n");
const rRow = call("checkExportRow", { doi: "10.1/r", retracted: true, update_type: "retraction", date: "2022-08-01", notice_doi: "10.1/r.n" }, "10.1/r", "") || {};
check("S3 retraction row keeps its columns, concern=No",
  rRow.Retracted === "Yes" && rRow["Retraction type"] === "retraction" && rRow["Retraction notice DOI"] === "10.1/r.n" && rRow["Expression of concern"] === "No");

// S4
const it = { "updated-by": [{ type: "expression_of_concern", label: "Expression of Concern", DOI: "10.1/c", updated: { "date-parts": [[2021, 5, 6]] } }] };
const cn = call("concernNotice", it);
check("S4 concernNotice finds expression_of_concern in updated-by", cn && cn.DOI === "10.1/c");
check("S4 concernNotice ignores update-to", call("concernNotice", { "update-to": it["updated-by"] }) === null);
check("S4 the retraction regex still does not match it", !/retract|withdraw|removal/i.test("expression_of_concern") && /const retractionOf = it =>[\s\S]{0,200}\/retract\|withdraw\|removal\/i/.test(html));
check("S4 Works search rows carry Expression of concern", /'Expression of concern': con \? 'Yes' : 'No'/.test(html));

// S5
const bib = String(call("toBibTeX", [{ DOI: "10.1/eoc", Title: "T", Retracted: "No", "Expression of concern": "Yes", "Concern date": "2021-05-06" }]));
check("S5 BibTeX: concern-only row gets an EXPRESSION OF CONCERN note", /note\s*=\s*\{EXPRESSION OF CONCERN/.test(bib) && !/RETRACTED/.test(bib));

// S6
check("S6 no bare 'Not retracted' left on the page", html.indexOf("Not retracted") < 0);

console.log("\n" + (ran - failed) + "/" + ran + " passed");
process.exit(failed ? 1 : 0);
