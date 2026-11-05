package main

import "crypto/rand"

// Content-Security-Policy, phase 2: every <script> tag in index.html
// carries nonce="__CSP_NONCE__", and each index response replaces that marker
// with a fresh nonce named in the policy header. The header is enforcing, so a
// script without the nonce is blocked.
//
// Style S1: the one <style> tag carries the same marker, and a separate
// Content-Security-Policy-Report-Only header reports (but does not block)
// styles without the nonce and every inline style attribute.
const (
	nonceMarker             = "__CSP_NONCE__"
	cspHeaderName           = "Content-Security-Policy"
	cspReportOnlyHeaderName = "Content-Security-Policy-Report-Only"
)

// nonceRandRead is the random source for the CSP nonce. It is a variable only
// so a test can make it fail.
var nonceRandRead = rand.Read

// contentSecurityPolicy is the policy for the index page. 'unsafe-inline' and
// https: are the backward-compatibility fallback for browsers that predate
// nonces and 'strict-dynamic'; browsers that understand nonce plus
// 'strict-dynamic' (Chrome 52+, Firefox 52+, Safari 15.4+) ignore both.
func contentSecurityPolicy(nonce string) string {
	return "script-src 'nonce-" + nonce + "' 'strict-dynamic' https: 'unsafe-inline'; script-src-attr 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
}

// styleReportOnlyPolicy is the Report-Only style policy for the index page. It
// uses the same nonce as contentSecurityPolicy.
func styleReportOnlyPolicy(nonce string) string {
	return "style-src 'nonce-" + nonce + "'; style-src-attr 'none'"
}
