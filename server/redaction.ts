const secretPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/gi,
  /\bsk-[A-Za-z0-9_-]{16,}/gi,
  /((?:api[_-]?key|authorization|token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,
];

export function redactSecrets(value: string): string {
  let redacted = value;
  for (const secret of [
    process.env.OPENAI_API_KEY,
    process.env.ANTHROPIC_API_KEY,
  ]) {
    if (secret) redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  for (const pattern of secretPatterns)
    redacted = redacted.replace(
      pattern,
      (_match, prefix: string | undefined) => `${prefix ?? ""}[REDACTED]`,
    );
  return redacted;
}
