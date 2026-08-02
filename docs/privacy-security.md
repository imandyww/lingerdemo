# Privacy, consent, and security

Linger is an oral-history archive, not passive monitoring. A person must intentionally consent and start every recording session. Recording status remains visible, and the person can pause, interrupt, end without saving, review extracted facts, correct them, or decline the save.

## Default retention

- `RAW_AUDIO_RETENTION=false`: audio is processed in memory and discarded. No raw audio is written or logged.
- WebSocket session transcripts are never persisted. `TRANSCRIPT_RETENTION=true` permits `Story.transcript` only after an explicitly confirmed archive save; setting it to `false` keeps archive metadata without the transcript. Ending without saving leaves no session transcript in the database.
- Demo mode uses scripted text and local seeded records. It requires no microphone and captures no audio.
- Sharing defaults to private. The story editor must explicitly change family-sharing permission.

To enable audio retention, an operator must provide an encrypted object store, document retention/deletion periods, add a separate informed-consent control naming those periods and recipients, restrict signed URL lifetimes, audit access, and test deletion across database, object, cache, and backup layers. Changing the environment flag alone is not a sufficient consent process.

## Application controls

- Mock authentication is prominently labeled and is suitable only for local demo use. Production must replace it with authenticated, server-validated sessions and family-scoped authorization.
- CORS and WebSocket origins are allow-listed. Non-local traffic requires HTTPS/WSS.
- JSON, audio frames, frequency, active sessions, and queue depths are bounded.
- Correlation IDs connect safe operational events without placing transcript text in metrics.
- Structured logs redact secret-bearing fields and omit raw audio. Provider error bodies are sanitized before logging.
- Tenstorrent remains on a private network or behind an authenticated, TLS-terminating reverse proxy. Do not publish its serving port.
- Provider credentials are server-only and must come from a secret manager in production.
- Database writes enforce family scope, consent, provenance, and transactional rollback.

## Product safety boundary

Linger does not diagnose dementia, monitor health, provide medical/legal/psychological advice, replace relatives, or pressure someone to discuss a painful event. The interviewer asks one concrete question at a time, respects corrections and uncertainty, and offers to stop when someone seems reluctant or tired.

For an urgent medical or immediate safety statement, the fixed response is:

> Linger isn’t an emergency service. Please contact a trusted person nearby or the appropriate emergency service now.

The application does not attempt diagnosis or extended crisis counseling.

## Production checklist

1. Add and test identity, session rotation, CSRF protection for HTTP mutations, family membership checks, and audit trails; only then replace the mock-auth boundary. This build fails closed when `MOCK_AUTH=false` because application authentication is intentionally not fabricated.
2. Use HTTPS/WSS only; set exact origins and secure proxy headers.
3. Move secrets into a managed secret store and rotate them regularly.
4. Use PostgreSQL with encryption at rest, private networking, backups, restore testing, and row/family access controls.
5. Place Inworld egress and Tenstorrent ingress behind explicit network policy. Never expose the model server publicly.
6. Configure per-user and per-family quotas in addition to process-local connection limits.
7. Define retention, export, deletion, legal basis, incident response, and family-sharing policies with counsel for the deployment jurisdiction.
8. Run dependency, container, and application security scans and complete abuse/privacy review before collecting real family histories.
