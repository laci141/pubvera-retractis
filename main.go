package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

const cliRunTimeout = 120 * time.Second

// Server-side timeouts. ReadHeaderTimeout was the only one set, which left the
// request BODY with no deadline at all: a size limit is not a time limit, and a
// client that sends its body one byte per minute holds a handler goroutine for
// as long as it likes. Caddy fronts this app in production and sets no request
// timeout of its own, so this is the only place the limit exists.
//
// WriteTimeout is the one that must not be guessed. It covers the whole
// response, and a CLI run is allowed cliRunTimeout to produce it, so anything
// at or below cliRunTimeout would cut off legitimate slow lookups rather than
// attacks — and only the slowest ones, intermittently, which is far harder to
// diagnose than the exposure being closed. It is derived from cliRunTimeout so
// that a change to the CLI budget carries here instead of silently leaving this
// too short.
const (
	srvReadHeaderTimeout = 10 * time.Second
	// The body is a small JSON object. Thirty seconds is far more than a real
	// client needs and far less than a slow-loris attacker wants.
	srvReadTimeout = 30 * time.Second
	// The full CLI budget plus room to write the response.
	srvWriteTimeout = cliRunTimeout + 30*time.Second
	// Keep-alive connections that go quiet are released rather than held.
	srvIdleTimeout = 120 * time.Second
)

// cliStderrLogMax caps how much of a failing child's stderr goes into one log
// line. The CLI's usage text is about 25 lines; 2000 runes keeps all of it and
// still bounds a runaway upstream error body. Same cap as pubvera-grantvera.
const cliStderrLogMax = 2000

// Request-body limits, checked before any CLI process is spawned. Every request
// body is a small JSON object: { doi }, { query, limit } or { doi, limit }.
//
// maxBodyBytes bounds the body itself; it also bounds every text field inside
// it, so no separate per-field length is set. maxResultLimit is the slider
// maximum in index.html (max="25") for both the search and the superseded
// limit. A larger value is rejected rather than clamped, so a caller learns
// the request was not honoured. Same shape as pubvera-recallis ab047a2.
const (
	maxBodyBytes   = 64 << 10
	maxResultLimit = 25
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8093" // retractis port: matches Dockerfile EXPOSE and compose; 8092 is devicera
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
		ReadHeaderTimeout: srvReadHeaderTimeout,
		ReadTimeout:       srvReadTimeout,
		WriteTimeout:      srvWriteTimeout,
		IdleTimeout:       srvIdleTimeout,
	}

	// The mailto value is logged as present/absent only. It is not a secret,
	// but echoing a contact address into every startup line serves no purpose.
	politeState := "off"
	if crossrefMailto() != "" {
		politeState = "on"
	}
	log.Printf("pubvera-retractis listening on 0.0.0.0:%s (CLI=%s, timeout=%s, slots=%d, crossref_polite=%s)",
		port, cliBinary(), cliRunTimeout, cliSem.capacity(), politeState)

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

// browserConfig is the bootstrap payload /config.json hands to the page so it
// can build its Supabase client. SupabaseAnonKey is the PUBLISHABLE
// (browser-side) key, never the secret one: it is designed to be visible in a
// browser and Row Level Security is what protects the data. It is still never
// logged.
type browserConfig struct {
	SupabaseURL     string `json:"supabase_url"`
	SupabaseAnonKey string `json:"supabase_anon_key"`
}

func handleRoot(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/config.json":
		// Deliberately NOT under /api/: Caddy protects /api/* with forward_auth,
		// and the page needs this config BEFORE it can sign anyone in. Serving it
		// from a protected path would make the requirement circular and force a
		// special-case exception into the Caddy matcher.
		//
		// A missing variable is not an error. An empty pair with status 200 is a
		// valid answer that puts the page into unauthenticated mode, which is what
		// keeps local development and the current deployment working until the
		// environment is set.
		supaURL := strings.TrimSpace(os.Getenv("SUPABASE_URL"))
		supaKey := strings.TrimSpace(os.Getenv("SUPABASE_PUBLISHABLE_KEY"))
		if supaURL == "" || supaKey == "" {
			supaURL, supaKey = "", ""
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		// Never cache: a stale key surviving a key rotation would be hard to
		// diagnose from the browser side.
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(browserConfig{SupabaseURL: supaURL, SupabaseAnonKey: supaKey})
	case "/":
		http.ServeFile(w, r, "index.html")
	default:
		http.NotFound(w, r)
	}
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

// crossrefMailto returns the contact address for the Crossref polite pool, or
// an empty string when unset. Crossref serves polite-pool callers from a
// separate bucket: measured against api.crossref.org, an anonymous request
// reports x-rate-limit-limit: 5 per second and a request carrying mailto
// reports 10. Halving the wall time of a large scan is the practical effect.
//
// The address is not a secret — it travels in the query string of every
// Crossref call by design, so that Crossref can reach the operator about
// traffic problems. Unset is a supported state: the CLI simply omits the flag
// and falls back to the anonymous pool.
func crossrefMailto() string {
	return strings.TrimSpace(os.Getenv("CROSSREF_MAILTO"))
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

	// Appended last, after every caller-supplied argument. cliCmdLabel stops at
	// the first flag, so a trailing --mailto cannot disturb the log label; put
	// in front, it would reduce every label to "?". Every subcommand this app
	// invokes (check, works search, superseded) accepts the flag.
	if m := crossrefMailto(); m != "" {
		args = append(args, "--mailto", m)
	}

	bin := cliBinary()
	cmd := exec.CommandContext(ctx, bin, args...)
	// stderr goes to the log, never to the client. The error returned below
	// reaches the browser as the response body via writeCLIError, and what the
	// CLI writes to stderr on failure is its own usage text, its version banner
	// and raw upstream messages, none of it bounded. That is operator
	// information: it belongs in the "cli: fail" log line, capped at
	// cliStderrLogMax, not in an HTTP response.
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
		log.Printf("cli: fail cmd=%s wait_ms=%d elapsed_ms=%d err=%v stderr=%s",
			label, waitMS, elapsed, err, truncate(strings.TrimSpace(stderr.String()), cliStderrLogMax))
		return nil, fmt.Errorf("CLI error: %v", err)
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

// decodeJSONRequest decodes one JSON object from the request body into dst.
// The body is capped at maxBodyBytes (413 above it), unknown fields are
// rejected, and so is anything after the object. Before this, every handler
// used a bare json.NewDecoder: no size limit, unknown fields and trailing data
// accepted, and bad input reached the child CLI, held a CLI slot and came back
// as 502 instead of 400.
func decodeJSONRequest(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
			return false
		}
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return false
	}
	if err := dec.Decode(new(struct{})); err != io.EOF {
		http.Error(w, "invalid JSON: trailing data after the request object", http.StatusBadRequest)
		return false
	}
	return true
}

// validateTextArg trims a free-text field in place and rejects it when empty or
// when it starts with '-'. The DOI is passed to the CLI as a positional
// argument and the query as a flag value; either one starting with a dash
// ("--help", "-json") could be read by the CLI's flag parser as a flag, still
// spawn a process, hold a CLI slot, and come back as a 502.
func validateTextArg(w http.ResponseWriter, name string, v *string) bool {
	*v = strings.TrimSpace(*v)
	if *v == "" {
		http.Error(w, "missing "+name, http.StatusBadRequest)
		return false
	}
	if strings.HasPrefix(*v, "-") {
		http.Error(w, name+" must not start with '-'", http.StatusBadRequest)
		return false
	}
	return true
}

// checkCeiling rejects a numeric field above its ceiling with a 400 naming the
// field. It runs before defaults are applied; 0 and negatives pass through to
// the default so an empty slider (JSON null -> 0) keeps working.
func checkCeiling(w http.ResponseWriter, name string, v, max int) bool {
	if v > max {
		http.Error(w, fmt.Sprintf("%s must be at most %d", name, max), http.StatusBadRequest)
		return false
	}
	return true
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
	if !decodeJSONRequest(w, r, &req) {
		return
	}
	if !validateTextArg(w, "doi", &req.DOI) {
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
	if !decodeJSONRequest(w, r, &req) {
		return
	}
	if !validateTextArg(w, "query", &req.Query) {
		return
	}
	if !checkCeiling(w, "limit", req.Limit, maxResultLimit) {
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
	if !decodeJSONRequest(w, r, &req) {
		return
	}
	if !validateTextArg(w, "doi", &req.DOI) {
		return
	}
	if !checkCeiling(w, "limit", req.Limit, maxResultLimit) {
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
