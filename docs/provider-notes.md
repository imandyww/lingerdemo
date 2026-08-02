# Provider implementation notes

Access date: **2026-08-01**. All provider-specific behavior below was checked against current official documentation, official examples, official source, or official package metadata. Runtime-dependent behavior is explicitly separated from verified behavior.

## Documentation consulted

- Inworld: [Introduction](https://docs.inworld.ai/introduction), [documentation index (`llms.txt`)](https://docs.inworld.ai/llms.txt), [API authentication](https://docs.inworld.ai/api-reference/introduction), [STT overview](https://docs.inworld.ai/stt/overview), [STT WebSocket reference](https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe-stream-websocket), [turn detection](https://docs.inworld.ai/stt/turn-detection), [official STT WebSocket example](https://github.com/inworld-ai/inworld-api-examples/blob/main/stt/python/example_stt_websocket.py), [TTS WebSocket guide](https://docs.inworld.ai/tts/synthesize-speech-websocket), [TTS WebSocket reference](https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-websocket), [audio formats](https://docs.inworld.ai/tts/capabilities/generating-audio), [official TTS WebSocket example](https://github.com/inworld-ai/inworld-api-examples/blob/main/tts/python/example_websocket.py), and [Python SDK](https://docs.inworld.ai/tts/python-sdk).
- Tenstorrent: [documentation root](https://docs.tenstorrent.com), [host installation](https://docs.tenstorrent.com/getting-started/README.html), [vLLM server deployment](https://docs.tenstorrent.com/getting-started/vLLM-servers.html), [`tt-inference-server` v0.19.0 release](https://github.com/tenstorrent/tt-inference-server/releases/tag/v0.19.0), [tagged serving README](https://github.com/tenstorrent/tt-inference-server/blob/v0.19.0/vllm-tt-metal/README.md), [official streaming client](https://github.com/tenstorrent/tt-inference-server/blob/v0.19.0/vllm-tt-metal/src/example_requests_client.py), [release model matrix](https://github.com/tenstorrent/tt-inference-server/blob/v0.19.0/release_model_spec.json), and [LLM support table](https://github.com/tenstorrent/tt-inference-server/blob/v0.19.0/docs/model_support/llm/README.md).
- SDK metadata/source: [Inworld TTS on PyPI](https://pypi.org/project/inworld-tts/), [OpenAI Python on PyPI](https://pypi.org/project/openai/), and [OpenAI `AsyncStream` v2.52.0 source](https://github.com/openai/openai-python/blob/v2.52.0/src/openai/_streaming.py).

## Selected versions

| Component | Pinned/target version | Reason |
| --- | --- | --- |
| OpenAI Python SDK | `openai==2.52.0` | Current official SDK; verified async Chat Completions streaming and `AsyncStream.close()`. |
| Inworld Python TTS SDK | `inworld-tts==1.2.1` | Current official package, but it wraps REST/chunked HTTP rather than the required persistent bidirectional WebSocket; Linger therefore uses the documented WebSocket wire protocol directly and does not add this SDK unused. |
| Tenstorrent inference server | repository release `v0.19.0` | Current official release published 2026-07-24; model artifacts still vary by device/model. |

Sources: [Inworld Python SDK](https://docs.inworld.ai/tts/python-sdk), [Inworld package](https://pypi.org/project/inworld-tts/), [OpenAI package](https://pypi.org/project/openai/), [Tenstorrent v0.19.0](https://github.com/tenstorrent/tt-inference-server/releases/tag/v0.19.0).

## Inworld authentication

The separated standalone STT and TTS APIs use a Standard API key on the backend:

```http
Authorization: Basic <INWORLD_API_KEY>
```

`INWORLD_API_KEY` is already the Base64 credential issued by Inworld; Linger must not concatenate or re-encode undocumented credential parts. Realtime-only keys/JWTs apply to Inworld's integrated Realtime API, not this independently orchestrated STT → Tenstorrent → TTS topology. Credentials remain server-side and are never logged. Source: [Inworld API authentication](https://docs.inworld.ai/api-reference/introduction).

The brief includes `INWORLD_API_SECRET` for deployment compatibility, but the verified standalone wire contract does not require Linger to derive a header from that field. It remains unused unless current account-specific official instructions say otherwise.

## Inworld streaming STT

Verified WebSocket:

```text
wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional
```

Verified model: `inworld/inworld-stt-1`.

The first message configures the stream:

```json
{
  "transcribeConfig": {
    "modelId": "inworld/inworld-stt-1",
    "audioEncoding": "LINEAR16",
    "sampleRateHertz": 16000,
    "numberOfChannels": 1,
    "language": "en"
  }
}
```

Audio and lifecycle messages:

```json
{"audioChunk":{"content":"<base64 audio>"}}
{"endTurn":{}}
{"closeStream":{}}
```

Normalized receive fields are `result.transcription.transcript`, `result.transcription.isFinal`, `result.speechStarted`, `result.speechStopped`, and `result.usage`. Only `isFinal: true` enters the LLM; speech-stop alone is not treated as stable text.

Streaming input is raw signed little-endian 16-bit PCM (`LINEAR16`), not MP3, Ogg Opus, or FLAC. The documented recommended default is 16 kHz mono. Linger validates or converts browser audio before this boundary and returns a user-safe unsupported-format error when it cannot.

Automatic end-of-turn detection is on by default. `endOfTurnConfidenceThreshold` and `inworldSttV1Config.vadThreshold` default to `0.5`. Manual mode sets `vadThreshold` to `0` and sends `endTurn`; documentation says manual turns currently have an approximately 30-second limit and notes that the limit may change. `closeStream` gracefully finishes the stream. No per-turn STT cancellation/reset event is documented.

Sources: [STT overview](https://docs.inworld.ai/stt/overview), [streaming WebSocket reference](https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe-stream-websocket), [turn detection](https://docs.inworld.ai/stt/turn-detection), [official STT Python example](https://github.com/inworld-ai/inworld-api-examples/blob/main/stt/python/example_stt_websocket.py).

## Inworld streaming TTS

The detailed AsyncAPI and official example agree on:

```text
wss://api.inworld.ai/tts/v1/voice:streamBidirectional
```

Verified client message names are `create`, `send_text`, `flush_context`, and `close_context`. Verified responses are `result.contextCreated`, `result.audioChunk.audioContent`, `result.flushCompleted`, and `result.contextClosed`. Audio content is Base64 inside JSON.

The detailed reference uses this wire shape (with Linger's raw-audio configuration):

```json
{"create":{"voiceId":"<configured>","modelId":"inworld-tts-2","audioConfig":{"audioEncoding":"PCM","sampleRateHertz":24000},"bufferCharThreshold":100,"autoMode":true,"timestampTransportStrategy":"ASYNC"},"contextId":"<turn context>"}
{"send_text":{"text":"<safe segment>","flush_context":{}},"contextId":"<turn context>"}
{"flush_context":{},"contextId":"<turn context>"}
{"close_context":{},"contextId":"<turn context>"}
```

For immediate AudioWorklet playback, Linger requests raw headerless signed little-endian 16-bit PCM:

```json
{
  "audioConfig": {
    "audioEncoding": "PCM",
    "sampleRateHertz": 24000
  }
}
```

The documented range is 8–48 kHz. `PCM` is raw bytes; Inworld's `LINEAR16` TTS response instead includes a WAV header in every chunk, so independent chunks must not be naïvely concatenated.

`inworld-tts-2` is a verified current model ID and remains configurable. A valid configurable voice ID is required. `send_text` is limited to 1,000 characters; a connection supports at most five contexts. `flush_context` starts buffered synthesis and `flushCompleted` corresponds to flushes sequentially.

There is **no documented standalone TTS cancellation message**. `close_context` implicitly flushes before closing and is not cancellation. On barge-in Linger immediately stops browser playback, invalidates the session/turn/context, clears unsynthesized text, discards late audio, and may close/recreate the provider connection as the documented safe transport reset. Whether socket closure immediately releases provider work/billing requires runtime confirmation.

Sources: [TTS WebSocket guide](https://docs.inworld.ai/tts/synthesize-speech-websocket), [detailed WebSocket reference](https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-websocket), [audio formats](https://docs.inworld.ai/tts/capabilities/generating-audio), [official TTS Python example](https://github.com/inworld-ai/inworld-api-examples/blob/main/tts/python/example_websocket.py).

### Document conflicts resolved

- `llms.txt` summarizes a different TTS WebSocket alias; the detailed AsyncAPI and official example agree on `/tts/v1/voice:streamBidirectional`, so Linger uses that path.
- `llms.txt` mentions `EXPRESSIVE`; the detailed API, generation guide, and official Python SDK specify `STABLE`, `BALANCED`, and `CREATIVE`. Linger uses only those detailed-schema values.
- An official Python example uses some snake_case convenience aliases while the AsyncAPI wire schema uses `contextId`, `voiceId`, `modelId`, and `audioConfig`. Linger follows the detailed schema casing; the selected account must still pass a live integration smoke test.

## Tenstorrent-hosted inference

The verified serving stack is `tt-inference-server`, which launches a Tenstorrent vLLM OpenAI-compatible server. Sources: [Tenstorrent vLLM deployment](https://docs.tenstorrent.com/getting-started/vLLM-servers.html), [v0.19.0 serving README](https://github.com/tenstorrent/tt-inference-server/blob/v0.19.0/vllm-tt-metal/README.md).

Verified endpoints:

```text
GET  http://<host>:8000/health
GET  http://<host>:8000/v1/models
POST http://<host>:8000/v1/chat/completions
POST http://<host>:8000/v1/completions
```

`/health` is specified as an HTTP-200 readiness check; Linger does not depend on an undocumented body. The model ID is read from `/v1/models`; a friendly launch name is not assumed to be the API ID.

Chat streaming uses `stream: true`, SSE `data:` frames containing `choices[0].delta.content`, and ends with `data: [DONE]`. `stream_options: {"include_usage": true}` requests usage when supported. The official SDK configuration is:

```python
AsyncOpenAI(base_url=TENSTORRENT_BASE_URL, api_key=TENSTORRENT_API_KEY)
```

If `VLLM_API_KEY` is configured by the server, it is sent as a Bearer token. If the launcher is configured only with `JWT_SECRET`, it derives the bearer token. With neither, the server disables authentication; Linger permits that only in an explicitly labeled loopback/local-development setup. `JWT_SECRET=testing` is documentation example text, not production guidance.

Closing the OpenAI SDK `AsyncStream` is verified. Tenstorrent documentation does not say whether that immediately aborts accelerator work. Linger cancels its task, closes the stream, and rejects late deltas by turn ID; accelerator-side release remains a live validation item. Source: [official streaming client](https://github.com/tenstorrent/tt-inference-server/blob/v0.19.0/vllm-tt-metal/src/example_requests_client.py), [OpenAI `AsyncStream` source](https://github.com/openai/openai-python/blob/v2.52.0/src/openai/_streaming.py).

## Hardware and model scope

This development workspace is `Darwin arm64`; `tt-smi` is not installed and `/dev/tenstorrent` is absent. No Tenstorrent hardware was detected, and this is not a claim about the operator's target host.

On the current `v0.19.0` matrix, `meta-llama/Llama-3.1-8B-Instruct` ranges from Complete (N150, N300, T3K, P150X4) through Experimental (P100, P150) to Functional (P150X8, P300/P300X2, Galaxy variants). QuietBox/LoudBox guidance recommends `meta-llama/Llama-3.3-70B-Instruct`, whereas add-in n/p cards generally use the 8B model. Artifact versions differ. Linger therefore makes no universal default compatibility claim and never manually mixes a model/device/container combination.

Sources: [authoritative v0.19.0 model matrix](https://github.com/tenstorrent/tt-inference-server/blob/v0.19.0/release_model_spec.json), [LLM support table](https://github.com/tenstorrent/tt-inference-server/blob/v0.19.0/docs/model_support/llm/README.md).

## Live validation still required

- Actual Inworld Standard API credential and its allowed scope.
- Selected Inworld voice ID and language quality.
- Exact TTS create-message aliases accepted by the account/API version.
- TTS socket-reset effect on server work and billing.
- Target Tenstorrent device/topology and installed firmware, kernel driver, runtime, and inference-server versions.
- Exact device/model entry and `/v1/models` ID for the deployed release.
- Authenticated `/health` and streamed Chat Completion from the API host.
- Whether stream closure immediately releases on-device generation.
- Warm-up behavior, queue limits, context limits, and measured latency on real hardware.
