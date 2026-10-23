# Manual code pairing implementation plan

Authorized by the user's PROCEED for manual IP entry, six-digit verification,
one receiver approval, remembered trust and actionable errors. Preserve every
Connections tab and existing layout. Discovery and network enrollment are out of scope.

## Security design

- Use pinned `@serenity-kit/opaque` 1.1.0 in the peer utility only, not a custom
  short-code hash or a PIN submitted over initially unverified TLS. Upstream's
  OPAQUE implementation has a published 7ASecurity review; that review does not
  establish the security of this integration or all subsequent library changes.
- Each incoming request has an unpredictable ID, random six-digit code, five
  minute deadline, at most five online attempts and a single-use OPAQUE login
  state. Existing global pairing limits remain. Codes and PAKE state are transient.
- The receiver performs local OPAQUE registration for this one-use code. Bind
  protocol version, request ID, both stable SPKI fingerprints and both names
  through the library's authenticated client/server identifiers. Never send the
  code, registration record, setup or session key over the network.
- The initiator's core receives the locally entered code through a closed IPC
  action and performs OPAQUE login through the existing pinned mutual TLS path.
  The receiver consumes each login attempt before parsing its finish proof.
  Correct verification sets remoteVerified; only a later local Allow action sets
  localVerified. Native/inventory access still requires both plus current sharing.
- Remove fingerprint-based approve/confirm from the renderer command contract.
  Old network confirm cannot authorize a code-based session. Refuse downgrade.
- Cancellation, expiry, decline and sharing shutdown erase code/PAKE state and
  deny late proofs/approvals. Repeated code entry remains bounded across retries.
- Persist only successful directional trust, peer public chains/name/address and
  approved GPU IDs, bound to this installation fingerprint. Use Windows CurrentUser
  DPAPI, private fixed peer directory, bounded files, link/reparse checks and atomic
  replacement. Persist revocation before acknowledging it; no plaintext fallback.
- Reconnect is an explicit fresh invitation using remembered addresses, followed
  by bounded retries. Both sides must match saved identities and current sharing;
  changed identities require new code and approval. Sharing remains off at startup.
  Renewed certificates with the same SPKI can reconnect after chain validation.
- Trust commits happen before enabling successful authorization. Failed persistence
  must not create an approved connection. Shutdown cannot resurrect revoked state.

## Execution

1. Review this concrete design before adding a dependency or changing trust behavior.
2. Write and run failing PAKE/session and trust-store tests; implement core modules.
3. Wire new verify-code/approve/cancel actions and native connection tests, including
   wrong code, spoofed identities, replay, expiry, limits and no preapproval access.
4. Persist/reload directional records, revocation and reconnect tests.
5. Replace fingerprint dialogs with code-entry, receiver code display then Allow/Deny,
   clear progress and errors. Add renderer tests first. Keep IP field and tabs intact.
6. Review the connected change; run scoped core, native, renderer, type/lint/format
   and packaging checks. Do not claim two-PC evidence until both apps are updated
   and the user completes the new verification flow. No commit/push/deploy is implied.

Sources: https://github.com/serenity-kit/opaque and
https://opaque-auth.com/docs/advanced_usage/identifiers and
https://7asecurity.com/reports/pentest-report-opaque.pdf.

## Review and implementation evidence

Primary-authored design and connected implementation received an independent
read-only review. Corrections included aggregate attempt limits across new IDs,
authenticated receiver completion, durable decline, cancellation after verification,
same-identity native-session cleanup, post-storage expiry checks, and retaining
offline permissions for revocation. Receiver approval and coordinator acceptance
persist separately; one-sided forgotten trust requires a fresh code exchange.

Automated development evidence: peer unit tests, real Windows TLS/DPAPI tests,
wrong code and preapproval denial, expiry during persistence, corruption,
cross-session binding, replay, saved trust/revocation, UI retry/cancel transitions,
type checks and development packaging. Actual new-flow interaction between PTSS
and HAOWERNSLAPPY is not claimed; the previous two-PC acceptance used fingerprints.
No remote app update, commit or push is part of this implementation turn.
