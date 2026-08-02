# AWS Amplify Hosting

The repository includes a root `amplify.yml` for the Next.js app in the npm
workspace at `apps/web`.

## Amplify setup

1. Connect the repository and the branch you want to deploy.
2. When Amplify detects a monorepo, select `apps/web` as the app root. Confirm
   that the branch has `AMPLIFY_MONOREPO_APP_ROOT=apps/web`; compute hosting
   uses this value to find the web workspace's `next` dependency.
3. Keep the build specification from the repository.
4. Add the environment variables below in **Hosting → Environment variables**.
5. Save the variables and redeploy the branch.

The frontend deploys in deterministic mock mode by default, so a fresh Amplify
app does not require a separately hosted API. To connect the live FastAPI
backend, set all three values below. The build intentionally fails if backend
mode is selected while either URL is absent or uses an insecure URL scheme:

```env
NEXT_PUBLIC_VOICE_PROVIDER=backend
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_WS_URL=wss://api.example.com/ws/voice
```

`NEXT_PUBLIC_API_URL` must use HTTPS and `NEXT_PUBLIC_WS_URL` must use WSS when
the Amplify site is served over HTTPS. The API must also include the Amplify
site origin in `ALLOWED_ORIGINS`.

To explicitly keep a branch in demo mode, set only:

```env
NEXT_PUBLIC_VOICE_PROVIDER=mock
```

The guided `/demo` route remains a deterministic local presentation. Use
`/conversation` for live microphone → Inworld STT → Tenstorrent LLM → Inworld
TTS operation.

## Server-side credentials

Amplify Hosting deploys the Next.js frontend only. Do not add these credentials
to `NEXT_PUBLIC_*` variables:

```env
INWORLD_API_KEY=
INWORLD_API_SECRET=
TENSTORRENT_API_KEY=
OPENAI_API_KEY=
DATABASE_URL=
```

Set those on the runtime hosting the FastAPI service. Setting them in Amplify
Hosting does not make them available to the Python container. Values prefixed
with `NEXT_PUBLIC_` are bundled into browser JavaScript and are not secret.

The frontend can load and browse its local seeded archive without the API. The
memory-extraction/save flow and backend voice mode require the FastAPI service.
