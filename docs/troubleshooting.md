# Troubleshooting

## The demo cannot reach the API

The scripted `/demo` flow remains usable through its local deterministic provider. Check that `npm run dev` shows both `web` and `api`, then open `http://localhost:8080/health`. If the API is intentionally offline, the interface should label local demo mode rather than pretending to save remotely.

## Microphone permission was denied

Use `/demo`, which does not require a microphone. For a live conversation, grant microphone access in browser site settings and reload. Linger never attempts to bypass denial and never starts capture automatically.

## The API does not start

- Confirm Python 3.12.x and `uv --version`.
- In mock mode, start the API and inspect `http://localhost:8080/ready`; it reports sanitized configuration issues without secret values.
- Ensure port 8080 is free or change `APP_PORT` and the browser API/WS URLs together.
- Run `npm run db:migrate`; check that the configured SQLite data directory is writable.

## Live mode says provider unavailable

This is fail-closed behavior. Read `docs/provider-notes.md` and run `npm run smoke:live`. Provide the required server-side credentials, voice/model configuration, and documented endpoints. A configured model example is not proof that it is installed or compatible with the attached Tenstorrent hardware.

## Inworld authentication or voice fails

Do not expose or paste credentials into the browser. Recheck the official authentication mechanism and credential scope recorded in provider notes. Confirm the configured voice and language are supported by the selected model. The user can continue with displayed text if TTS fails.

## Tenstorrent is unavailable or the model is not loaded

Confirm the operator-supplied health URL and model listing behavior for the actual serving release. Keep the endpoint private. Test it from the API host, then run the smoke test. Linger never falls back to a cloud LLM and never assumes the example model fits the hardware.

## Audio is silent or delayed

- Check the visible playback error and development diagnostics panel.
- Confirm the browser allows audio playback after the intentional user gesture.
- Verify negotiated encoding, sample rate, channel count, and container exactly match the provider result.
- Do not concatenate independent WAV headers or reinterpret provider-native bytes.
- Interrupt and retry; stale audio from an older turn is intentionally discarded.

## A save failed

The reviewed extraction remains visible and marked unsaved. Resolve database availability and choose **Confirm and save story** again. Do not refresh until the retry succeeds or the transcript has been exported. Failed transactions do not create partial people, timeline, or question records.

## Reset demo data

The credential-free `/demo` resets its browser-local fixture whenever **Start the conversation** is chosen, and **Run demo again** returns to that start. The API seed command is idempotent but intentionally does not erase saved archive data. Never delete an entire production database to reset a demonstration.
