package main

import (
	"bytes"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// The CLI explains itself on stderr and exits non-zero: an unknown command
// prints its whole usage text, its version banner, and on a network failure
// whatever the upstream API said, all unbounded. runCLI captures that, and it
// belongs in the log. What it must not do is put it in the error it returns,
// because writeCLIError writes that error straight into the HTTP response body
// for all three endpoints.
//
// Same contract and same mechanism as pubvera-grantvera's bf90280: a real child
// process that fails the way the real CLI does, driven through the real handler.

// stubStderr is what the fake CLI writes to stderr before failing. It stands in
// for the real CLI's usage banner: distinctive enough that finding any part of
// it in an HTTP body is unambiguous.
const stubStderr = "UNKNOWN-COMMAND-BANNER usage: retraction-checker check <doi> --json"

// buildFailingStubCLI compiles a child CLI that writes to stderr and exits 1,
// then points CLI_BIN at it for the duration of the test.
func buildFailingStubCLI(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	src := `package main
import (
	"fmt"
	"os"
)
func main() {
	fmt.Fprintln(os.Stderr, ` + "`" + stubStderr + "`" + `)
	os.Exit(1)
}
`
	if err := os.WriteFile(filepath.Join(dir, "main.go"), []byte(src), 0o600); err != nil {
		t.Fatalf("write stub source: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module failstub\n\ngo 1.26\n"), 0o600); err != nil {
		t.Fatalf("write stub go.mod: %v", err)
	}
	bin := filepath.Join(dir, "failstub")
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}
	cmd := exec.Command("go", "build", "-o", bin, ".")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("build failing stub CLI: %v\n%s", err, out)
	}
	t.Setenv("CLI_BIN", bin)
}

// captureLog redirects the standard logger for the duration of fn and returns
// what was written. The logger is process-global, so the previous destination
// and flags are restored on the way out, and tests using this must not run in
// parallel with anything that logs.
func captureLog(t *testing.T, fn func()) string {
	t.Helper()
	var buf bytes.Buffer
	prevOut, prevFlags := log.Writer(), log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0)
	defer func() {
		log.SetOutput(prevOut)
		log.SetFlags(prevFlags)
	}()
	fn()
	return buf.String()
}

// TestCLIFailureKeepsStderrOutOfTheResponse is the guard. The stub always
// fails, so the handler always takes the error path, and the assertion is on
// the body the client gets.
func TestCLIFailureKeepsStderrOutOfTheResponse(t *testing.T) {
	buildFailingStubCLI(t)

	code, body, _ := postCheck(t, "10.1000/stderr-test")

	if code != 502 {
		t.Errorf("status = %d, want 502: a failing CLI is an upstream failure", code)
	}

	// No fragment of the child's stderr may appear. Several fragments rather
	// than the full line, so a future change that truncates or reformats stderr
	// before embedding it is still caught as a leak.
	for _, fragment := range []string{
		"UNKNOWN-COMMAND-BANNER",
		"usage:",
		"retraction-checker",
		"--json",
	} {
		if strings.Contains(body, fragment) {
			t.Errorf("response body contains child stderr fragment %q\nbody: %s", fragment, body)
		}
	}

	// The client still needs to be told something went wrong; a blank body
	// would be its own defect.
	if !strings.Contains(body, "CLI error") {
		t.Errorf("response body = %q, want it to still name the failure", body)
	}
}

// TestCLIFailureStillLogsStderr is the other half of the contract. Keeping
// stderr out of the response must not take away the operator's only
// explanation of why the run failed.
func TestCLIFailureStillLogsStderr(t *testing.T) {
	buildFailingStubCLI(t)

	logged := captureLog(t, func() {
		postCheck(t, "10.1000/stderr-test")
	})

	if !strings.Contains(logged, "UNKNOWN-COMMAND-BANNER") {
		t.Errorf("log does not carry the child stderr; operators lose the only\nexplanation of the failure.\nlog: %s", logged)
	}
}
