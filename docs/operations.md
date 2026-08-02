# Operational steps for live providers

The application ships ready for credential-free mock use. Connecting real speech and inference requires operator-owned provider accounts and physical or remotely managed Tenstorrent hardware.

1. Read `provider-notes.md` and recheck linked official documentation against the pinned SDK versions.
2. Supply Inworld server credentials, a verified STT model/configuration, a supported TTS model, voice ID, language, and documented audio settings.
3. Supply the exact Tenstorrent hardware/product, firmware/runtime and serving-stack versions, device topology, loaded instruction model, private base URL, authentication method, health URL, TLS/proxy arrangement, and context limit.
4. Verify the chosen model is supported by that hardware and server release. The `.env.example` values are examples only.
5. Keep both integrations server-side, run `npm run smoke:live`, and resolve every failed/unavailable check.
6. Set live mode only after smoke checks pass: `VOICE_PROVIDER=inworld` and `LLM_PROVIDER=tenstorrent`.
7. Implement and test real authentication/family authorization before setting `MOCK_AUTH=false`; this build otherwise fails closed. Then use PostgreSQL and managed secrets, deploy HTTPS/WSS, configure exact origins/quotas, and complete the privacy/security checklist.
8. Run contract, unit, integration, browser, and interruption tests in the deployment environment before allowing real family recordings.

## Dependency advisory gate

As of 2026-08-01, `npm audit --omit=dev` reports three high-severity advisories in `postcss@8.4.31` and `sharp@0.34.5`, both transitively bundled by the current stable `next@16.2.12`. npm proposes an invalid downgrade rather than a compatible patched stable Next release. The web app disables Next image optimization, declares no remote image patterns, uses no user-supplied CSS/source maps, and does not treat those mitigations as a permanent fix. Re-run the audit and upgrade to the first compatible patched stable Next release before production deployment; do not force incompatible transitive overrides.
