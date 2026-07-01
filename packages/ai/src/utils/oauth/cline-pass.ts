/**
 * ClinePass OAuth flow.
 *
 * ClinePass is Cline's flat-rate subscription provider for open coding models.
 * Auth uses WorkOS device authorization, then exchanges the WorkOS tokens for
 * Cline-scoped tokens at the Cline backend. The Cline access token is used as
 * a Bearer token for OpenAI-compatible /chat/completions requests.
 *
 * Endpoints and the WorkOS client ID were extracted from the published Cline
 * CLI binary (cline 3.0.34, @cline/cli-darwin-arm64). The Cline backend token
 * exchange payload is inferred from the endpoint set (/api/v1/auth/token,
 * /api/v1/auth/refresh) and the documented response shape; it needs
 * verification against a live ClinePass subscription.
 */

import { getProviderEnvValue } from "../provider-env.ts";
import { pollOAuthDeviceCodeFlow } from "./device-code.ts";
import type { OAuthCredentials, OAuthDeviceCodeInfo, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.ts";
import type { Api, Model } from "../../types.ts";

const DEFAULT_WORKOS_CLIENT_ID = "client_01K3A541FN8TA3EPPHTD2325AR";
const WORKOS_BASE = "https://api.workos.com";
const WORKOS_DEVICE_AUTH_URL = `${WORKOS_BASE}/user_management/authorize/device`;
const WORKOS_TOKEN_URL = `${WORKOS_BASE}/user_management/authenticate`;
const CLINE_API_BASE = "https://api.cline.bot/api/v1";
const CLINE_TOKEN_URL = `${CLINE_API_BASE}/auth/token`;
const CLINE_REFRESH_URL = `${CLINE_API_BASE}/auth/refresh`;
const DEVICE_CODE_TIMEOUT_SECONDS = 15 * 60;

const CLINE_PASS_HEADERS = {
	"HTTP-Referer": "https://cline.bot",
	"X-Title": "Cline",
} as const;

type WorkOSDeviceCodeResponse = {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete?: string;
	expires_in: number;
	interval?: number;
};

type WorkOSTokenResponse = {
	access_token: string;
	refresh_token: string;
	token_type?: string;
	expires_in: number;
};

type WorkOSTokenError = {
	error: string;
	error_description?: string;
};

type ClineTokenResponse = {
	success?: boolean;
	data?: {
		accessToken: string;
		refreshToken: string;
		tokenType?: string;
		expiresAt?: string;
	};
};

function getClientId(): string {
	return getProviderEnvValue("MISUL_CLINE_PASS_CLIENT_ID") || DEFAULT_WORKOS_CLIENT_ID;
}

async function startWorkOSDeviceAuth(clientId: string, signal?: AbortSignal): Promise<WorkOSDeviceCodeResponse> {
	const response = await fetch(WORKOS_DEVICE_AUTH_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ client_id: clientId }),
		signal,
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`WorkOS device auth request failed (${response.status}): ${text || response.statusText}`);
	}

	const data = (await response.json()) as Partial<WorkOSDeviceCodeResponse>;
	if (
		typeof data.device_code !== "string" ||
		typeof data.user_code !== "string" ||
		typeof data.verification_uri !== "string" ||
		typeof data.expires_in !== "number"
	) {
		throw new Error(`Invalid WorkOS device code response: ${JSON.stringify(data)}`);
	}

	let parsedUri: URL;
	try {
		parsedUri = new URL(data.verification_uri);
	} catch {
		throw new Error("Untrusted verification_uri in WorkOS device code response");
	}
	if (parsedUri.protocol !== "https:" && parsedUri.protocol !== "http:") {
		throw new Error("Untrusted verification_uri in WorkOS device code response");
	}

	return {
		device_code: data.device_code,
		user_code: data.user_code,
		verification_uri: parsedUri.href,
		verification_uri_complete: data.verification_uri_complete,
		expires_in: data.expires_in,
		interval: typeof data.interval === "number" ? data.interval : undefined,
	};
}

async function pollWorkOSToken(
	clientId: string,
	device: WorkOSDeviceCodeResponse,
	signal?: AbortSignal,
): Promise<WorkOSTokenResponse> {
	return pollOAuthDeviceCodeFlow<WorkOSTokenResponse>({
		intervalSeconds: device.interval,
		expiresInSeconds: device.expires_in ?? DEVICE_CODE_TIMEOUT_SECONDS,
		signal,
		poll: async () => {
			const response = await fetch(WORKOS_TOKEN_URL, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					grant_type: "urn:ietf:params:oauth:grant-type:device_code",
					device_code: device.device_code,
					client_id: clientId,
				}),
				signal,
			});

			if (response.ok) {
				const json = (await response.json()) as Partial<WorkOSTokenResponse>;
				if (typeof json.access_token === "string" && typeof json.refresh_token === "string") {
					return { status: "complete", value: json as WorkOSTokenResponse };
				}
				return { status: "failed", message: `Invalid WorkOS token response: ${JSON.stringify(json)}` };
			}

			const body = await response.text().catch(() => "");
			let errorCode: string | undefined;
			try {
				const json = JSON.parse(body) as Partial<WorkOSTokenError>;
				errorCode = json.error;
			} catch {
				// Non-JSON error body: fall through to generic failure below.
			}

			if (errorCode === "authorization_pending" || response.status === 400) {
				return { status: "pending" };
			}
			if (errorCode === "slow_down") {
				return { status: "slow_down" };
			}
			if (errorCode === "expired_token") {
				return { status: "failed", message: "WorkOS device code expired" };
			}
			if (errorCode === "access_denied") {
				return { status: "failed", message: "WorkOS device flow access denied" };
			}

			return {
				status: "failed",
				message: `WorkOS token poll failed (${response.status}): ${body || response.statusText}`,
			};
		},
	});
}

async function exchangeWithClineBackend(
	workosToken: WorkOSTokenResponse,
	signal?: AbortSignal,
): Promise<OAuthCredentials> {
	const response = await fetch(CLINE_TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${workosToken.access_token}`,
		},
		signal,
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Cline token exchange failed (${response.status}): ${text || response.statusText}`);
	}

	const json = (await response.json()) as Partial<ClineTokenResponse>;
	const data = json.data;
	if (!data?.accessToken || !data.refreshToken) {
		throw new Error(`Invalid Cline token exchange response: ${JSON.stringify(json)}`);
	}

	const expires = data.expiresAt ? Date.parse(data.expiresAt) : Date.now() + workosToken.expires_in * 1000;
	if (!Number.isFinite(expires)) {
		throw new Error(`Invalid Cline token expiry: ${data.expiresAt}`);
	}

	return {
		access: data.accessToken,
		refresh: data.refreshToken,
		expires: expires - 5 * 60 * 1000,
	};
}

async function refreshClineToken(refreshToken: string): Promise<OAuthCredentials> {
	const response = await fetch(CLINE_REFRESH_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ refreshToken }),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Cline token refresh failed (${response.status}): ${text || response.statusText}`);
	}

	const json = (await response.json()) as Partial<ClineTokenResponse>;
	const data = json.data;
	if (!data?.accessToken || !data.refreshToken) {
		throw new Error(`Invalid Cline refresh response: ${JSON.stringify(json)}`);
	}

	const expires = data.expiresAt ? Date.parse(data.expiresAt) : Date.now() + 3600 * 1000;
	return {
		access: data.accessToken,
		refresh: data.refreshToken,
		expires: (Number.isFinite(expires) ? expires : Date.now() + 3600 * 1000) - 5 * 60 * 1000,
	};
}

async function loginClinePass(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const clientId = getClientId();
	const device = await startWorkOSDeviceAuth(clientId, callbacks.signal);

	callbacks.onDeviceCode({
		userCode: device.user_code,
		verificationUri: device.verification_uri_complete ?? device.verification_uri,
		intervalSeconds: device.interval,
		expiresInSeconds: device.expires_in ?? DEVICE_CODE_TIMEOUT_SECONDS,
	});

	const workosToken = await pollWorkOSToken(clientId, device, callbacks.signal);
	return exchangeWithClineBackend(workosToken, callbacks.signal);
}

export const clinePassOAuthProvider: OAuthProviderInterface = {
	id: "cline-pass",
	name: "ClinePass",

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		return loginClinePass(callbacks);
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		return refreshClineToken(credentials.refresh);
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},

	modifyModels(models: Model<Api>[], _credentials: OAuthCredentials): Model<Api>[] {
		return models.map((m) =>
			m.provider === "cline-pass"
				? { ...m, headers: { ...m.headers, ...CLINE_PASS_HEADERS } }
				: m,
		);
	},
};
