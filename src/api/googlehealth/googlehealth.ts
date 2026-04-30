const BASE_URL = "https://health.googleapis.com/v4";

export class HealthApiError extends Error {
    constructor(
        public status: number,
        message: string
    ) {
        super(message);
        this.name = "HealthApiError";
    }
}

/**
 * Typed fetch wrapper for the Google Health API.
 * Adds Authorization header and handles errors.
 */
export async function healthFetch<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
        mode: "cors",
        signal,
    });

    if (!response.ok) {
        const text = await response.text();
        throw new HealthApiError(response.status, `Google Health API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
}
