// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useContext } from "react";
import { AuthProvider, needsRefreshOnMount, AuthContext } from "../AuthProvider";
import * as oauth from "../oauth";

vi.mock("../oauth", () => ({
    startAuth: vi.fn(),
    exchangeCode: vi.fn(),
    refreshAccessToken: vi.fn(),
}));

const STORAGE_TOKEN = "googlehealth_token";
const STORAGE_USER_ID = "googlehealth_user_id";
const STORAGE_REFRESH_TOKEN = "googlehealth_refresh_token";
const STORAGE_TOKEN_EXPIRY = "googlehealth_token_expiry";

const REFRESH_BEFORE_MS = 5 * 60 * 1000;

let store: Record<string, string>;

function mockLocalStorage() {
    store = {};
    const ls = {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
            store[key] = value;
        },
        removeItem: (key: string) => {
            delete store[key];
        },
        clear: () => {
            store = {};
        },
        get length() {
            return Object.keys(store).length;
        },
        key: (index: number) => Object.keys(store)[index] ?? null,
    };
    vi.stubGlobal("localStorage", ls);
}

function setStoredCredentials(opts: {
    accessToken?: string;
    userId?: string;
    refreshToken?: string;
    expiresIn?: number;
    expired?: boolean;
}) {
    const {
        accessToken = "valid-token",
        userId = "user-1",
        refreshToken = "refresh-token",
        expiresIn = 3600,
        expired = false,
    } = opts;
    const expiryMs = expired ? Date.now() - 60_000 : Date.now() + expiresIn * 1000;
    localStorage.setItem(STORAGE_TOKEN, accessToken);
    localStorage.setItem(STORAGE_USER_ID, userId);
    localStorage.setItem(STORAGE_REFRESH_TOKEN, refreshToken);
    localStorage.setItem(STORAGE_TOKEN_EXPIRY, String(expiryMs));
}

function clearStoredCredentials() {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER_ID);
    localStorage.removeItem(STORAGE_REFRESH_TOKEN);
    localStorage.removeItem(STORAGE_TOKEN_EXPIRY);
}

/** Hook that reads AuthContext from inside AuthProvider */
function useAuthState() {
    return useContext(AuthContext);
}

describe("needsRefreshOnMount", () => {
    it("returns false when no refresh token", () => {
        expect(needsRefreshOnMount({ refreshToken: null, expiryMs: 0 })).toBe(false);
    });

    it("returns false when token is still valid with plenty of time", () => {
        const expiryMs = Date.now() + 3600_000;
        expect(needsRefreshOnMount({ refreshToken: "rt", expiryMs })).toBe(false);
    });

    it("returns true when token is expired", () => {
        const expiryMs = Date.now() - 60_000;
        expect(needsRefreshOnMount({ refreshToken: "rt", expiryMs })).toBe(true);
    });

    it("returns true when token is within REFRESH_BEFORE_MS of expiry", () => {
        const expiryMs = Date.now() - 1000;
        expect(needsRefreshOnMount({ refreshToken: "rt", expiryMs })).toBe(true);
    });

    it("returns true when token is exactly at REFRESH_BEFORE_MS boundary", () => {
        const expiryMs = Date.now() - REFRESH_BEFORE_MS;
        expect(needsRefreshOnMount({ refreshToken: "rt", expiryMs })).toBe(true);
    });

    it("returns false when token has more than REFRESH_BEFORE_MS remaining", () => {
        const expiryMs = Date.now() + 10 * 60 * 1000;
        expect(needsRefreshOnMount({ refreshToken: "rt", expiryMs })).toBe(false);
    });

    it("returns true with refresh token but zero expiry (never set)", () => {
        expect(needsRefreshOnMount({ refreshToken: "rt", expiryMs: 0 })).toBe(true);
    });
});

describe("AuthProvider initialization", () => {
    let originalLocation: Location;

    beforeEach(() => {
        originalLocation = window.location;
        mockLocalStorage();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Object.defineProperty(window, "location", {
            value: originalLocation,
            writable: true,
            configurable: true,
        });
    });

    function mockLocation(url: string) {
        const urlObj = new URL(url);
        Object.defineProperty(window, "location", {
            value: {
                href: urlObj.href,
                pathname: urlObj.pathname,
                search: urlObj.search,
                origin: urlObj.origin,
                replace: vi.fn(),
                assign: vi.fn(),
                reload: vi.fn(),
                protocol: urlObj.protocol,
                host: urlObj.host,
                hostname: urlObj.hostname,
                port: urlObj.port,
            },
            writable: true,
            configurable: true,
        });
    }

    it("exposes valid token immediately when stored token is fresh", () => {
        setStoredCredentials({ accessToken: "fresh-token", expired: false });
        mockLocation("http://localhost/");

        const { result } = renderHook(() => useAuthState(), {
            wrapper: AuthProvider,
        });

        expect(result.current.loading).toBe(false);
        expect(result.current.token).toBe("fresh-token");
        expect(result.current.userId).toBe("user-1");
    });

    it("hides expired token and sets loading=true on first render", () => {
        setStoredCredentials({ accessToken: "expired-token", expired: true });
        mockLocation("http://localhost/");

        // Mock refresh to return a pending promise so we can observe the
        // initial loading=true state before the async refresh completes.
        let resolveRefresh: (result: oauth.TokenResult) => void;
        vi.mocked(oauth.refreshAccessToken).mockReturnValue(
            new Promise((resolve) => {
                resolveRefresh = resolve;
            })
        );

        const { result } = renderHook(() => useAuthState(), {
            wrapper: AuthProvider,
        });

        // Before refresh completes: loading must be true, token must be null.
        // This is the key regression test for the 401-on-reopen bug: the
        // expired token must NOT be exposed to consumers while refreshing.
        expect(result.current.loading).toBe(true);
        expect(result.current.token).toBeNull();
        expect(result.current.userId).toBeNull();

        // Resolve the pending refresh so the effect cleanup doesn't leak
        resolveRefresh!({
            accessToken: "refreshed-token",
            expiresIn: 3600,
            refreshToken: "refresh-token",
            userId: "user-1",
        });
    });

    it("updates token and loading after successful refresh of expired token", async () => {
        setStoredCredentials({ accessToken: "expired-token", expired: true });
        mockLocation("http://localhost/");

        vi.mocked(oauth.refreshAccessToken).mockResolvedValue({
            accessToken: "new-valid-token",
            expiresIn: 3600,
            refreshToken: "new-refresh-token",
            userId: "user-1",
        });

        const { result } = renderHook(() => useAuthState(), {
            wrapper: AuthProvider,
        });

        // Initially loading
        expect(result.current.loading).toBe(true);
        expect(result.current.token).toBeNull();

        // After refresh completes
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.token).toBe("new-valid-token");
        expect(result.current.userId).toBe("user-1");
    });

    it("clears token on refresh failure", async () => {
        setStoredCredentials({ accessToken: "expired-token", expired: true });
        mockLocation("http://localhost/");

        vi.mocked(oauth.refreshAccessToken).mockRejectedValue(new Error("Refresh failed"));

        const { result } = renderHook(() => useAuthState(), {
            wrapper: AuthProvider,
        });

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.token).toBeNull();
        expect(result.current.userId).toBeNull();
    });

    it("starts with loading=false and token=null when no stored credentials", () => {
        clearStoredCredentials();
        mockLocation("http://localhost/");

        const { result } = renderHook(() => useAuthState(), {
            wrapper: AuthProvider,
        });

        expect(result.current.loading).toBe(false);
        expect(result.current.token).toBeNull();
    });
});
