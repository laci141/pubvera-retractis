package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"time"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8092"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/check", handleCheck)
	mux.HandleFunc("/api/search", handleSearch)
	mux.HandleFunc("/api/superseded", handleSuperseded)
	mux.HandleFunc("/healthz", handleHealthz)
	mux.HandleFunc("/", handleRoot)

	srv := &http.Server{
		Addr:              "0.0.0.0:" + port,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("pubvera-retractis listening on 0.0.0.0:%s (CLI=%s)", port, cliBinary())
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func handleRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, "index.html")
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

func cliBinary() string {
	if b := os.Getenv("CLI_BIN"); b != "" {
		return b
	}
	return "./retraction-checker"
}

// runCLI executes the CLI with the given args, returning stdout bytes.
// stderr is captured separately so CLI warnings never corrupt the JSON body.
func runCLI(args ...string) ([]byte, error) {
	bin := cliBinary()
	cmd := exec.Command(bin, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("CLI error: %v — stderr: %s", err, stderr.String())
	}
	return stdout.Bytes(), nil
}

func writeRaw(w http.ResponseWriter, b []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.Write(b)
}

// ------ API: /api/check ------
type checkRequest struct {
	DOI string `json:"doi"`
}

func handleCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "only POST", http.StatusMethodNotAllowed)
		return
	}
	var req checkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if req.DOI == "" {
		http.Error(w, "missing doi", http.StatusBadRequest)
		return
	}

	out, err := runCLI("check", req.DOI, "--json")
	if err != nil {
		log.Print(err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	// The check command emits a flat JSON object — pass it through unchanged
	// so the frontend sees exactly: {input, doi, title, retracted, update_type, published, signals}
	writeRaw(w, out)
}

// ------ API: /api/search ------
// Uses `works search --query <q> --rows <n>` which hits the LIVE Crossref API
// (NOT the local FTS5 `search` command, which needs synced data).
type searchRequest struct {
	Query string `json:"query"`
	Limit int    `json:"limit,omitempty"`
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "only POST", http.StatusMethodNotAllowed)
		return
	}
	var req searchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if req.Query == "" {
		http.Error(w, "missing query", http.StatusBadRequest)
		return
	}
	if req.Limit <= 0 {
		req.Limit = 10
	}

	out, err := runCLI("works", "search",
		"--query", req.Query,
		"--rows", fmt.Sprintf("%d", req.Limit),
		"--json")
	if err != nil {
		log.Print(err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	// The CLI already returns the exact Crossref envelope the frontend expects:
	//   { meta:{source}, results:{ status, message-type, message:{ total-results, items:[...] } } }
	// Pass it through unchanged.
	writeRaw(w, out)
}

// ------ API: /api/superseded ------
// `superseded <doi> --limit <n> --json` returns:
//   { doi, title, retracted, from_year, query, related:[ {title, doi, publication_year, cited_by_count, id} ] }
type supersededRequest struct {
	DOI   string `json:"doi"`
	Limit int    `json:"limit,omitempty"`
}

func handleSuperseded(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "only POST", http.StatusMethodNotAllowed)
		return
	}
	var req supersededRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}
	if req.DOI == "" {
		http.Error(w, "missing doi", http.StatusBadRequest)
		return
	}
	if req.Limit <= 0 {
		req.Limit = 10
	}

	out, err := runCLI("superseded", req.DOI,
		"--limit", fmt.Sprintf("%d", req.Limit),
		"--json")
	if err != nil {
		log.Print(err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	// Pass through the object with related[] — the frontend renders the table + citation bars.
	writeRaw(w, out)
}