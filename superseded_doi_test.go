package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
)

const supersededDOIError = "doi must be a DOI such as 10.1038/nature12373"

func doiBody(t *testing.T, doi string) string {
	t.Helper()
	b, err := json.Marshal(map[string]string{"doi": doi})
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestSupersededRejectsNonDOI(t *testing.T) {
	missingCLI(t)
	for _, doi := range []string{"Wakefield 1998", "10.1038", "10.12/x", "10.123/x", "10.1038/ x", "nature12373"} {
		t.Run(strconv.Quote(doi), func(t *testing.T) {
			rec := post(handleSuperseded, "/api/superseded", doiBody(t, doi))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
			}
			if got := errorField(t, rec); got != supersededDOIError {
				t.Fatalf("error = %q, want %q", got, supersededDOIError)
			}
		})
	}
}

func TestSupersededAcceptsDOIForms(t *testing.T) {
	missingCLI(t)
	for _, doi := range []string{
		"10.1038/nature12373",
		"doi:10.1038/nature12373",
		"https://doi.org/10.1038/nature12373",
		"HTTPS://DOI.ORG/10.1038/x",
	} {
		t.Run(strconv.Quote(doi), func(t *testing.T) {
			rec := post(handleSuperseded, "/api/superseded", doiBody(t, doi))
			if rec.Code == http.StatusBadRequest || errorField(t, rec) == supersededDOIError {
				t.Fatalf("rejected by DOI check: status=%d body=%q", rec.Code, rec.Body.String())
			}
		})
	}
}

// handleCheck also accepts PMIDs and free text; the DOI check must not apply there.
func TestCheckNotDOIGated(t *testing.T) {
	missingCLI(t)
	rec := post(handleCheck, "/api/check", doiBody(t, "Wakefield 1998"))
	if errorField(t, rec) == supersededDOIError {
		t.Fatalf("/api/check returned the superseded DOI error: %q", rec.Body.String())
	}
}
