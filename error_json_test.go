package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// index.html reads every error response as JSON and shows its "error" field.
// A plain-text body from http.Error does not parse, so the page replaced the
// real reason ("limit must be at most 25") with "Server returned an
// unreadable response (HTTP 400)". Every error this app writes itself must
// therefore be a JSON object with a non-empty "error" string.
//
// The 503 from the CLI semaphore is covered by semaphore_test.go; the page
// shows a fixed message for 503 and reads no field from it.

func TestErrorResponsesAreJSON(t *testing.T) {
	missingCLI(t)
	cases := []struct {
		name   string
		fn     func(http.ResponseWriter, *http.Request)
		method string
		body   string
		want   int
		reason string // a fragment the "error" field must contain
	}{
		{"method", handleCheck, http.MethodGet, ``, http.StatusMethodNotAllowed, "only POST"},
		{"invalid JSON", handleCheck, http.MethodPost, `{`, http.StatusBadRequest, "invalid JSON"},
		{"unknown field", handleSearch, http.MethodPost, `{"query":"aspirin","bogus":1}`, http.StatusBadRequest, "invalid JSON"},
		{"trailing data", handleSuperseded, http.MethodPost, `{"doi":"10.1000/valid"}{}`, http.StatusBadRequest, "trailing data"},
		{"too large", handleCheck, http.MethodPost, `{"doi":"` + strings.Repeat("a", oversizeBody) + `"}`, http.StatusRequestEntityTooLarge, "too large"},
		{"missing field", handleCheck, http.MethodPost, `{"doi":"  "}`, http.StatusBadRequest, "missing doi"},
		{"leading dash", handleSearch, http.MethodPost, `{"query":"--help"}`, http.StatusBadRequest, "must not start with '-'"},
		{"ceiling", handleSearch, http.MethodPost, `{"query":"aspirin","limit":26}`, http.StatusBadRequest, "at most 25"},
		{"CLI failure", handleCheck, http.MethodPost, `{"doi":"10.1000/valid"}`, http.StatusBadGateway, "CLI error"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(c.method, "/", strings.NewReader(c.body))
			rec := httptest.NewRecorder()
			c.fn(rec, req)

			if rec.Code != c.want {
				t.Fatalf("status = %d, want %d; body=%q", rec.Code, c.want, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
				t.Errorf("Content-Type = %q, want application/json", ct)
			}
			var got struct {
				Error string `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("body is not JSON: %v\nbody: %q", err, rec.Body.String())
			}
			if got.Error == "" {
				t.Fatalf("JSON has no non-empty \"error\" field: %q", rec.Body.String())
			}
			if !strings.Contains(got.Error, c.reason) {
				t.Errorf("error = %q, want it to contain %q", got.Error, c.reason)
			}
		})
	}
}
