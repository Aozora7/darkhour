const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = "openid https://www.googleapis.com/auth/googlehealth.sleep.readonly";

function getClientId(): string {
    const id = import.meta.env.VITE_GOOGLE_HEALTH_CLIENT_ID as string | undefined;
    if (!id) throw new Error("VITE_GOOGLE_HEALTH_CLIENT_ID is not set in .env");
    return id;
}

function getClientSecret(): string {
    const secret = import.meta.env.VITE_GOOGLE_HEALTH_CLIENT_SECRET as string | undefined;
    if (!secret) throw new Error("VITE_GOOGLE_HEALTH_CLIENT_SECRET is not set in .env");
    return secret;
}

function getRedirectUri(): string {
    return window.location.origin + "/";
}

function decodeBase64Url(input: string): string {
    const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (base64.length % 4)) % 4;
    const padded = base64 + "=".repeat(padLen);
    return atob(padded);
}

function getSubFromIdToken(idToken: string): string {
    const parts = idToken.split(".");
    if (parts.length < 2) throw new Error("Invalid id_token");
    const payloadJson = decodeBase64Url(parts[1]!);
    const payload = JSON.parse(payloadJson) as { sub?: string };
    if (!payload.sub) throw new Error("id_token missing sub");
    return payload.sub;
}

/** Generate a cryptographically random string for PKCE code_verifier */
function generateVerifier(length = 128): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const values = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(values, (v) => chars[v % chars.length]).join("");
}

/** Compute SHA-256 hash and return as base64url */
async function computeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Start the OAuth PKCE authorization flow.
 * Generates a verifier, stores it, and redirects to Google.
 */
export async function startAuth(): Promise<void> {
    const verifier = generateVerifier();
    localStorage.setItem("pkce_verifier", verifier);

    const challenge = await computeChallenge(verifier);
    const clientId = getClientId();
    const redirectUri = getRedirectUri();

    const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent",
    });

    window.location.href = `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface TokenResult {
    accessToken: string;
    expiresIn: number;
    refreshToken: string;
    userId: string;
}

async function postToTokenEndpoint(body: URLSearchParams): Promise<TokenResult> {
    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Token request failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
        access_token: string;
        expires_in: number;
        refresh_token?: string;
        id_token?: string;
    };

    if (!data.id_token) throw new Error("Token response missing id_token");
    const userId = getSubFromIdToken(data.id_token);

    return {
        accessToken: data.access_token,
        expiresIn: data.expires_in,
        refreshToken: data.refresh_token ?? "",
        userId,
    };
}

/**
 * Exchange the authorization code for an access token.
 * Called after the OAuth redirect with ?code=... in the URL.
 */
export async function exchangeCode(code: string): Promise<TokenResult> {
    const verifier = localStorage.getItem("pkce_verifier");
    if (!verifier) throw new Error("No PKCE verifier found in session");

    const clientId = getClientId();
    const clientSecret = getClientSecret();
    const redirectUri = getRedirectUri();

    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
    });

    const result = await postToTokenEndpoint(body);
    localStorage.removeItem("pkce_verifier");
    return result;
}

/**
 * Use a refresh token to obtain a new access token.
 * Some providers use rolling refresh — the returned refreshToken may replace the old one.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResult> {
    const clientId = getClientId();
    const clientSecret = getClientSecret();

    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
    });

    return postToTokenEndpoint(body);
}
