package main

import (
	"errors"
	"net/http"
	"os"
	"regexp"
	"strings"
	"testing"
)

// CSP phase 2: every <script> tag in index.html carries nonce="__CSP_NONCE__",
// and each index response replaces that marker with a fresh nonce named in the
// enforcing Content-Security-Policy header. All requests go in-process
// through getRoot (root_cache_test.go), on handleRoot or on newMux().

// wantPolicy is written out here rather than taken from contentSecurityPolicy,
// so a change to any directive in csp.go fails a test.
func wantPolicy(nonce string) string {
	return "script-src 'nonce-" + nonce + "' 'strict-dynamic' https: 'unsafe-inline'; script-src-attr 'none'; style-src 'nonce-" + nonce + "'; style-src-attr 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
}

// The header names and the marker are spelled out so a renamed constant cannot
// agree with itself.
const (
	reportOnlyHeader = "Content-Security-Policy-Report-Only"
	enforcingHeader  = "Content-Security-Policy"
	nonceMarkerText  = "__CSP_NONCE__"
)

// index.html has 4 <script> tags: the external xlsx-js-style bundle, two
// classic inline scripts and one module.
const wantScriptTags = 4

// Style S1: index.html has 1 <style> tag; it carries the same nonce marker.
const wantStyleTags = 1

var styleOpenRE = regexp.MustCompile(`<style\b[^>]*>`)

// 16 random bytes in raw standard base64 are exactly 22 characters.
var cspNonceRE = regexp.MustCompile(`^script-src 'nonce-([A-Za-z0-9+/]{22})' `)

var scriptOpenRE = regexp.MustCompile(`<script\b[^>]*>`)

var bodyNonceRE = regexp.MustCompile(`nonce="([^"]*)"`)

// indexNonce fetches / and returns the header nonce, body and headers. It
// stops the test when there is no nonce to compare against; the header checks
// themselves live in the tests below.
func indexNonce(t *testing.T) (string, string, http.Header) {
	t.Helper()
	rec := getRoot(t, http.HandlerFunc(handleRoot), "/", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /: status = %d, want 200", rec.Code)
	}
	csp := rec.Header().Get(enforcingHeader)
	m := cspNonceRE.FindStringSubmatch(csp)
	if m == nil {
		t.Fatalf("GET /: %s = %q, want a policy with a 22-character nonce", enforcingHeader, csp)
	}
	return m[1], rec.Body.String(), rec.Header()
}

func TestCSPMarkerReplacedInResponse(t *testing.T) {
	nonce, body, _ := indexNonce(t)
	if strings.Contains(body, nonceMarkerText) {
		t.Errorf("GET /: body still contains %s", nonceMarkerText)
	}
	if n := strings.Count(body, `nonce="`+nonce+`"`); n != wantScriptTags+wantStyleTags {
		t.Errorf("GET /: %d tags carry the header nonce, want %d", n, wantScriptTags+wantStyleTags)
	}
}

func TestCSPNonceIsFreshPerResponse(t *testing.T) {
	a, _, _ := indexNonce(t)
	b, _, _ := indexNonce(t)
	if a == b {
		t.Errorf("two responses carried the same nonce %q", a)
	}
}

func TestCSPHeaderNonceMatchesEveryBodyNonce(t *testing.T) {
	nonce, body, _ := indexNonce(t)
	tags := scriptOpenRE.FindAllString(body, -1)
	if len(tags) != wantScriptTags {
		t.Errorf("GET /: %d <script> tags, want %d", len(tags), wantScriptTags)
	}
	for _, tag := range tags {
		if !strings.Contains(tag, ` nonce="`+nonce+`"`) {
			t.Errorf("GET /: tag %s does not carry the header nonce %q", tag, nonce)
		}
	}
	for _, m := range bodyNonceRE.FindAllStringSubmatch(body, -1) {
		if m[1] != nonce {
			t.Errorf("GET /: body nonce %q differs from header nonce %q", m[1], nonce)
		}
	}
}

func TestCSPHeaderIsEnforcingWithExactPolicy(t *testing.T) {
	nonce, _, h := indexNonce(t)
	if got := h.Get(enforcingHeader); got != wantPolicy(nonce) {
		t.Errorf("%s = %q, want %q", enforcingHeader, got, wantPolicy(nonce))
	}
	if cspHeaderName != enforcingHeader {
		t.Errorf("cspHeaderName = %q, want %q", cspHeaderName, enforcingHeader)
	}
}

// TestCSPNoReportOnlyHeader does not use indexNonce, so a missing enforcing
// header does not hide the Report-Only-header check. Style S2: scripts and
// styles are both enforced, so there is no Report-Only header at all.
func TestCSPNoReportOnlyHeader(t *testing.T) {
	rec := getRoot(t, http.HandlerFunc(handleRoot), "/", "")
	if got := rec.Header().Values(reportOnlyHeader); len(got) != 0 {
		t.Errorf("GET /: %s = %q, want none", reportOnlyHeader, got)
	}
	if got := rec.Header().Values(enforcingHeader); len(got) != 1 {
		t.Errorf("GET /: %s sent %d times (%q), want 1", enforcingHeader, len(got), got)
	}
}

// Style S2: the enforcing header names the script nonce for style-src too and
// blocks every inline style attribute.
func TestCSPStyleIsEnforced(t *testing.T) {
	nonce, _, h := indexNonce(t)
	got := h.Get(enforcingHeader)
	for _, want := range []string{"style-src 'nonce-" + nonce + "'", "style-src-attr 'none'"} {
		if !strings.Contains(got, want) {
			t.Errorf("%s = %q, want it to contain %q", enforcingHeader, got, want)
		}
	}
}

func TestCSPStyleTagCarriesHeaderNonce(t *testing.T) {
	nonce, body, _ := indexNonce(t)
	tags := styleOpenRE.FindAllString(body, -1)
	if len(tags) != wantStyleTags {
		t.Errorf("GET /: %d <style> tags, want %d", len(tags), wantStyleTags)
	}
	for _, tag := range tags {
		if !strings.Contains(tag, ` nonce="`+nonce+`"`) {
			t.Errorf("GET /: tag %s does not carry the header nonce %q", tag, nonce)
		}
	}
}

func TestCSPIndexFileMarksEveryStyle(t *testing.T) {
	data, err := os.ReadFile("index.html")
	if err != nil {
		t.Fatal(err)
	}
	tags := styleOpenRE.FindAll(data, -1)
	if len(tags) != wantStyleTags {
		t.Errorf("index.html: %d <style> tags, want %d", len(tags), wantStyleTags)
	}
	for _, tag := range tags {
		if !strings.Contains(string(tag), ` nonce="`+nonceMarkerText+`"`) {
			t.Errorf("index.html: tag %s has no nonce marker", tag)
		}
	}
}

// Never stored, so a cached copy cannot replay one nonce to every visitor.
func TestCSPIndexIsNoStore(t *testing.T) {
	rec := getRoot(t, http.HandlerFunc(handleRoot), "/", "")
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("GET /: Cache-Control = %q, want %q", cc, "no-store")
	}
}

func TestCSPIndexFileMarksEveryScript(t *testing.T) {
	data, err := os.ReadFile("index.html")
	if err != nil {
		t.Fatal(err)
	}
	tags := scriptOpenRE.FindAll(data, -1)
	if len(tags) != wantScriptTags {
		t.Errorf("index.html: %d <script> tags, want %d", len(tags), wantScriptTags)
	}
	for _, tag := range tags {
		if !strings.Contains(string(tag), ` nonce="`+nonceMarkerText+`"`) {
			t.Errorf("index.html: tag %s has no nonce marker", tag)
		}
	}
}

// Fail closed: no nonce means no page and no policy.
func TestCSPRandFailureIs500(t *testing.T) {
	orig := nonceRandRead
	nonceRandRead = func([]byte) (int, error) { return 0, errors.New("no entropy") }
	defer func() { nonceRandRead = orig }()
	rec := getRoot(t, http.HandlerFunc(handleRoot), "/", "")
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("GET /: status = %d, want 500", rec.Code)
	}
	for _, name := range []string{reportOnlyHeader, enforcingHeader} {
		if got := rec.Header().Get(name); got != "" {
			t.Errorf("GET /: %s = %q, want none", name, got)
		}
	}
	if body := rec.Body.String(); strings.Contains(body, "<script") {
		t.Errorf("GET /: body contains <script despite nonce failure")
	}
}

// A missing index.html answers what http.ServeFile answered before phase 1
// (measured through newMux()): 404 "404 page not found\n" with no
// Cache-Control at all, since ServeFile's error path dropped the no-cache it
// had been given. It carries no policy either.
func TestCSPMissingIndexIs404WithoutPolicy(t *testing.T) {
	t.Chdir(t.TempDir()) // no index.html to read here
	rec := getRoot(t, newMux(), "/", "")
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /: status = %d, want 404", rec.Code)
	}
	if got, want := rec.Body.String(), "404 page not found\n"; got != want {
		t.Errorf("GET /: body = %q, want %q", got, want)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "" {
		t.Errorf("GET /: Cache-Control = %q, want none", cc)
	}
	for _, name := range []string{reportOnlyHeader, enforcingHeader} {
		if got := rec.Header().Get(name); got != "" {
			t.Errorf("GET /: %s = %q, want none", name, got)
		}
	}
}

// /healthz and /version are registered on newMux(), not in handleRoot, so
// this test goes through the full route table.
func TestCSPOnlyOnTheIndexPage(t *testing.T) {
	mux := newMux()
	for _, path := range []string{"/nope", "/config.json", "/healthz"} {
		rec := getRoot(t, mux, path, "")
		for _, name := range []string{reportOnlyHeader, enforcingHeader} {
			if got := rec.Header().Get(name); got != "" {
				t.Errorf("GET %s: %s = %q, want none", path, name, got)
			}
		}
	}
}
