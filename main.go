package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

const cliRunTimeout = 120 * time.Second

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
	log.Printf("pubvera-retractis listening on 0.0.0.0:%s (CLI=%s, timeout=%s, slots=%d)",
		port, cliBinary(), cliRunTimeout, cliSem.capacity())
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

// cliCmdLabel names the subcommand for the log without leaking user input.
// Flags and their values are dropped, so a DOI or a search query never
// reaches the log; only the leading verbs survive ("check", "works search").
func cliCmdLabel(args []string) string {
	var verbs []string
	for _, a := range args {
		if strings.HasPrefix(a, "-") {
			break
		}
		verbs = append(verbs, a)
		if len(verbs) == 2 {
			break
		}
	}
	if len(verbs) == 0 {
		return "?"
	}
	// The second word is only a verb for "works search"; for "check <doi>"
	// it would be the DOI itself, so keep it only when it is a known verb.
	if len(verbs) == 2 && verbs[1] != "search" {
		verbs = verbs[:1]
	}
	return strings.Join(verbs, " ")
}

// runCLI runs the child CLI bounded by a concurrency slot and a deadline.
// stderr is captured separately so CLI warnings never corrupt the JSON body.
// The slot is acquired BEFORE the timeout so queuing time does not eat into
// the 120s CLI budget.
//
// Every run is logged with the "cli:" prefix. Three facts are recorded that
// nothing else in this service exposes: how long the run waited for a
// concurrency slot, how long the child process itself took, and how many
// bytes it produced. A sudden drop in bytes is the earliest visible sign of
// an upstream quota or API failure. User input is never logged — see
// cliCmdLabel.
func runCLI(ctx context.Context, args ...string) ([]byte, error) {
	label := cliCmdLabel(args)
	waitStart := time.Now()

	if err := cliSem.acquire(ctx); err != nil {
		log.Printf("cli: busy cmd=%s wait_ms=%d err=%v",
			label, time.Since(waitStart).Milliseconds(), err)
		return nil, err
	}
	defer cliSem.release()

	waitMS := time.Since(waitStart).Milliseconds()

	ctx, cancel := context.WithTimeout(ctx, cliRunTimeout)
	defer cancel()

	bin := cliBinary()
	cmd := exec.CommandContext(ctx, bin, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	runStart := time.Now()
	if err := cmd.Run(); err != nil {
		elapsed := time.Since(runStart).Milliseconds()
		if ctxErr := ctx.Err(); ctxErr != nil {
			log.Printf("cli: fail cmd=%s wait_ms=%d elapsed_ms=%d err=deadline",
				label, waitMS, elapsed)
			return nil, fmt.Errorf("CLI stopped after %s: %v", cliRunTimeout, ctxErr)
		}
		log.Printf("cli: fail cmd=%s wait_ms=%d elapsed_ms=%d err=%v",
			label, waitMS, elapsed, err)
		return nil, fmt.Errorf("CLI error: %v — stderr: %s", err, stderr.String())
	}

	// A successful run can still have written to stderr, and those messages are
	// the ones worth seeing: the CLI prints its rate-limit and server-error
	// retries there while the command goes on to succeed. Logging stderr only on
	// failure discarded exactly the warnings that explain a slow but successful
	// request. Safe here because this app passes no BYOK key to the child — a
	// keyless CLI cannot echo a secret it never received.
	if w := strings.TrimSpace(stderr.String()); w != "" {
		log.Printf("cli: ok cmd=%s wait_ms=%d elapsed_ms=%d bytes=%d stderr=%s",
			label, waitMS, time.Since(runStart).Milliseconds(), stdout.Len(), truncate(w, 300))
	} else {
		log.Printf("cli: ok cmd=%s wait_ms=%d elapsed_ms=%d bytes=%d",
			label, waitMS, time.Since(runStart).Milliseconds(), stdout.Len())
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

	out, err := runCLI(r.Context(), "check", req.DOI, "--json")
	if err != nil {
		log.Print(err)
		writeCLIError(w, err)
		return
	}
	writeRaw(w, out)
}

// ------ API: /api/search ------
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

	out, err := runCLI(r.Context(), "works", "search",
		"--query", req.Query,
		"--rows", fmt.Sprintf("%d", req.Limit),
		"--json")
	if err != nil {
		log.Print(err)
		writeCLIError(w, err)
		return
	}
	writeRaw(w, out)
}

// ------ API: /api/superseded ------
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

	out, err := runCLI(r.Context(), "superseded", req.DOI,
		"--limit", fmt.Sprintf("%d", req.Limit),
		"--json")
	if err != nil {
		log.Print(err)
		writeCLIError(w, err)
		return
	}
	writeRaw(w, out)
}

// truncate caps a log line at max runes. Rune-based, not byte-based: a stderr
// message can carry UTF-8, and slicing bytes would split a character and put
// an invalid sequence in the log. Same shape as pubvera-corpova's.
func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "..."
}
