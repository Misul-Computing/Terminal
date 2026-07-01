// Secret redaction for LLM context. Replaces detected secrets in message
// text with placeholders before they reach the provider. Redaction is
// one-way: the model never sees the real value, only that a secret was there.

import type { Message, TextContent } from "@misul/ai";

// Patterns are deliberately conservative to avoid false positives on
// ordinary code or base64-encoded data. Each matches a known secret format
// with enough structure to be reliable.
const PATTERNS: Array<{ re: RegExp; label: string }> = [
	// AWS access key: 20 chars, starts with AKIA/ASIA/AGPA/AROA/AIDA/ANPA
	{ re: /\b((?:AKIA|ASIA|AGPA|AROA|AIDA|ANPA)[A-Z0-9]{16})\b/g, label: "AWS_KEY" },
	// AWS secret key: 40 chars base64 after "aws_secret" or in JSON with aws_secret_access_key
	{ re: /(["']?aws_secret_access_key["']?\s*[:=]\s*["']?)([A-Za-z0-9/+=]{40})(["']?)/gi, label: "AWS_SECRET" },
	// GitHub token: ghp_, gho_, ghu_, ghs_, ghr_ followed by 36 chars
	{ re: /\b(gh[pousr]_[A-Za-z0-9]{36})\b/g, label: "GITHUB_TOKEN" },
	// GitHub fine-grained: github_pat_ followed by 22+ chars
	{ re: /\b(github_pat_[A-Za-z0-9_]{22,})\b/g, label: "GITHUB_PAT" },
	// Anthropic key: sk-ant- followed by 95+ chars
	{ re: /\b(sk-ant-[A-Za-z0-9_\-]{95,})\b/g, label: "ANTHROPIC_KEY" },
	// OpenAI key: sk- followed by 48+ chars (newer format sk-proj- or sk-)
	{ re: /\b(sk-(?:proj-)?[A-Za-z0-9_\-]{48,})\b/g, label: "OPENAI_KEY" },
	// Generic API key in env/JSON: key=..., api_key=..., token=... with 20+ char value
	{ re: /((?:api[_-]?key|token|secret|password|passwd|auth)\s*[:=]\s*["']?)([A-Za-z0-9_\-]{20,})(["']?)/gi, label: "GENERIC_SECRET" },
	// Bearer tokens in Authorization headers
	{ re: /(Bearer\s+)([A-Za-z0-9_\-\.]{20,})/gi, label: "BEARER_TOKEN" },
	// Private key blocks (PEM)
	{ re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g, label: "PRIVATE_KEY" },
	// Slack token: xoxb-, xoxp-, xoxa-, xoxr- followed by 10-13 chars, dash, 10-13 chars
	{ re: /\b(xox[abpr]-[A-Za-z0-9-]{10,})\b/g, label: "SLACK_TOKEN" },
	// Stripe key: sk_live_, sk_test_, rk_live_, rk_test_ followed by 24+ chars
	{ re: /\b((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,})\b/g, label: "STRIPE_KEY" },
	// JWT: three base64url segments separated by dots
	{ re: /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g, label: "JWT" },
];

const PLACEHOLDER = (label: string) => `[REDACTED:${label}]`;

/** Redact secrets from a string, returning the cleaned text. */
export function redactString(text: string): string {
	let result = text;
	for (const { re, label } of PATTERNS) {
		result = result.replace(re, (_match, ...groups) => {
			// For patterns with capture groups, preserve the prefix/suffix
			// and only redact the secret value.
			if (groups.length >= 2 && typeof groups[0] === "string" && typeof groups[1] === "string") {
				const prefix = groups[0];
				const suffix = groups.length >= 3 && typeof groups[2] === "string" ? groups[2] : "";
				return `${prefix}${PLACEHOLDER(label)}${suffix}`;
			}
			return PLACEHOLDER(label);
		});
	}
	return result;
}

/** Redact secrets from message content (string or array of text/image parts). */
function redactContent(content: string | (TextContent | { type: string; [k: string]: unknown })[]): string | (TextContent | { type: string; [k: string]: unknown })[] {
	if (typeof content === "string") {
		return redactString(content);
	}
	if (Array.isArray(content)) {
		return content.map((part) => {
			if (part.type === "text" && "text" in part) {
				return { ...part, text: redactString(part.text as string) };
			}
			return part;
		});
	}
	return content;
}

/** Redact secrets from an array of LLM messages. Returns a new array. */
export function redactMessages(messages: Message[]): Message[] {
	return messages.map((msg) => ({
		...msg,
		content: redactContent(msg.content as string | (TextContent | { type: string; [k: string]: unknown })[]) as any,
	}));
}
