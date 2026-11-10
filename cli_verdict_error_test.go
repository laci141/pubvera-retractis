package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

// A failed lookup must never reach the page as a verdict.
//
// The check command prints its verdict as JSON. When the lookup fails (Crossref
// has no record, Crossref or PubMed cannot be reached), that JSON carries an
// "error" field and "retracted": false. The CLI pinned until 2026-11 exited 0
// in that case, so /api/check answered 200 and the page drew "Not retracted"
// for a DOI it had never seen. The current upstream CLI exits 1 instead, which
// without handling here would turn every failed lookup into a bare
// "CLI error: exit status 1".
//
// Both shapes must end as an error response with a fixed message: the CLI's
// own error text carries the raw upstream response body (client.APIError) and
// stays in the log, like stderr.

// buildVerdictStubCLI compiles a child CLI that prints body to stdout and exits
// with code, then points CLI_BIN at it for the duration of the test.
func buildVerdictStubCLI(t *testing.T, body string, code int) {
	t.Helper()
	dir := t.TempDir()
	src := `package main
import (
	"fmt"
	"os"
)
func main() {
	fmt.Println(` + "`" + body + "`" + `)
	os.Exit(` + strconv.Itoa(code) + `)
}
`
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte(src), 0o600); err != nil {
		t.Fatalf("write stub source: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module verdictstub\n\ngo 1.26\n"), 0o600); err != nil {
		t.Fatalf("write stub go.mod: %v", err)
	}
	bin := filepath.Join(dir, "verdictstub")
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}
	cmd := exec.Command("go", "build", "-o", bin, ".")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build verdict stub CLI: %v\n%s", err, out)
	}
	t.Setenv("CLI_BIN", bin)
}

// The raw upstream body the CLI's client.APIError appends to its message. It
// must reach the log, never the response.
const upstreamBody = "UPSTREAM-BODY-Resource-not-found"

func postCheckDOI(t *testing.T) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/check", strings.NewReader(`{"doi":"10.1234/none"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handleCheck(rec, req)
	return rec
}

func errorField(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var got struct {
		Error     string `json:"error"`
		Retracted *bool  `json:"retracted"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("response is not JSON: %v\n%s", err, rec.Body.String())
	}
	if got.Retracted != nil {
		t.Fatalf("an error response must not carry a verdict, got retracted=%v", *got.Retracted)
	}
	return got.Error
}

func TestCheckLookupErrorIsNotAVerdict(t *testing.T) {
	cases := []struct {
		name   string
		body   string
		code   int
		status int
		msg    string
	}{
		{"not found, exit 1 (current CLI)",
			`{"input":"10.1234/none","doi":"10.1234/none","retracted":false,"error":"GET /works/10.1234/none returned HTTP 404: ` + upstreamBody + `"}`,
			1, http.StatusNotFound, msgCLINotFound},
		{"not found, exit 0 (CLI pinned before 2026-11)",
			`{"input":"10.1234/none","doi":"10.1234/none","retracted":false,"error":"GET /works/10.1234/none returned HTTP 404: ` + upstreamBody + `"}`,
			0, http.StatusNotFound, msgCLINotFound},
		{"PMID without a DOI",
			`{"input":"12345678","retracted":false,"error":"no DOI found for PMID 12345678"}`,
			1, http.StatusNotFound, msgCLINotFound},
		{"upstream unreachable",
			`{"input":"10.1234/none","doi":"10.1234/none","retracted":false,"error":"GET /works/10.1234/none returned HTTP 503: ` + upstreamBody + `"}`,
			1, http.StatusBadGateway, msgCLILookupFailed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			buildVerdictStubCLI(t, c.body, c.code)
			var rec *httptest.ResponseRecorder
			logged := captureLog(t, func() { rec = postCheckDOI(t) })
			if rec.Code != c.status {
				t.Fatalf("status = %d, want %d; body %s", rec.Code, c.status, rec.Body.String())
			}
			if got := errorField(t, rec); got != c.msg {
				t.Fatalf("error = %q, want %q", got, c.msg)
			}
			if strings.Contains(rec.Body.String(), upstreamBody) {
				t.Fatalf("upstream body leaked into the response: %s", rec.Body.String())
			}
			if strings.Contains(c.body, upstreamBody) && !strings.Contains(logged, upstreamBody) {
				t.Fatalf("the CLI's error text must stay in the log, got log:\n%s", logged)
			}
		})
	}
}

// A real verdict still passes through untouched, including the expression of
// concern fields the current CLI adds.
func TestCheckVerdictPassesThrough(t *testing.T) {
	body := `{"input":"10.1/x","doi":"10.1/x","retracted":false,"expression_of_concern":true,"update_type":"expression_of_concern"}`
	buildVerdictStubCLI(t, body, 0)
	var rec *httptest.ResponseRecorder
	captureLog(t, func() { rec = postCheckDOI(t) })
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", rec.Code, rec.Body.String())
	}
	if strings.TrimSpace(rec.Body.String()) != body {
		t.Fatalf("verdict changed on the way through:\n got %s\nwant %s", rec.Body.String(), body)
	}
}
