// Server API client. Same origin in production (the server serves this app); Vite proxies in dev.
import type { PaymentConfig, RentalView } from "@evenhand/shared";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, signal: AbortSignal.timeout(90_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `request failed (${res.status})`, res.status);
  return body;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  rental: (id: string) => request<RentalView>(`/rentals/${id}`),
  rentals: (owner: string) => request<RentalView[]>(`/rentals?owner=${owner}`),
  arbiterQueue: () => request<RentalView[]>("/rentals?queue=arbiter"),
  paymentConfig: () => request<PaymentConfig>("/payment-config"),
  createRental: (body: unknown) => post<{ rentalId: string; payUrl: string; txHash?: string }>("/rentals", body),
  fund: (id: string, body: unknown) => post<{ txHash: string }>(`/rentals/${id}/fund`, body),
  confirm: (id: string, phase: "pickup" | "return", body: unknown) => post<{ ok: boolean; txHash?: string }>(`/rentals/${id}/scans/${phase}/confirm`, body),
  health0g: () => request<{ router: boolean; storage: boolean }>("/health/0g"),
};
