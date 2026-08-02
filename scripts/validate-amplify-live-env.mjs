const errors = [];

if (process.env.NEXT_PUBLIC_VOICE_PROVIDER !== "backend") {
  errors.push("NEXT_PUBLIC_VOICE_PROVIDER must be set to backend");
}

function requireUrl(name, protocol) {
  const value = process.env[name];
  if (!value) {
    errors.push(`${name} is required`);
    return;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== protocol) {
      errors.push(`${name} must use ${protocol.replace(":", "")}`);
    }
  } catch {
    errors.push(`${name} must be a valid URL`);
  }
}

requireUrl("NEXT_PUBLIC_API_URL", "https:");
requireUrl("NEXT_PUBLIC_WS_URL", "wss:");

if (errors.length > 0) {
  console.error("Amplify live configuration is incomplete:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Amplify live backend configuration is valid.");
