// 0G Router inspection call (docs/interfaces.md section 8).
import { z } from "zod";
import type { Angle } from "@evenhand/shared";
import { fetchWithTimeout } from "../net.js";
import { RUBRIC_V1 } from "./rubric.js";

export type RouterConfig = { routerUrl: string; apiKey: string; trustMode: string };
export type ImagePair = { angle: Angle; pickupJpeg: Buffer; returnJpeg: Buffer };

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };

export type InspectionRequest = {
  model: string;
  temperature: 0;
  max_tokens: 700;
  response_format: { type: "json_object" };
  verify_tee: true;
  messages: [{ role: "system"; content: string }, { role: "user"; content: (TextPart | ImagePart)[] }];
};

const jpegDataUrl = (jpeg: Buffer) => `data:image/jpeg;base64,${jpeg.toString("base64")}`;

/** Static rubric first, then rental ID and labelled PICKUP/RETURN pairs in angle order. */
export function buildInspectionRequest(model: string, rentalId: string, pairs: ImagePair[]): InspectionRequest {
  const order = pairs.map((p) => p.angle).join(", ");
  const content: (TextPart | ImagePart)[] = [
    {
      type: "text",
      text: `rental_id: ${rentalId}\nPairs follow in order ${order}. For each angle: first image = PICKUP, second = RETURN.`,
    },
  ];
  for (const p of pairs) {
    content.push({ type: "text", text: `${p.angle} PICKUP` }, { type: "image_url", image_url: { url: jpegDataUrl(p.pickupJpeg) } });
    content.push({ type: "text", text: `${p.angle} RETURN` }, { type: "image_url", image_url: { url: jpegDataUrl(p.returnJpeg) } });
  }
  return {
    model,
    temperature: 0,
    max_tokens: 700,
    response_format: { type: "json_object" },
    verify_tee: true,
    messages: [
      { role: "system", content: RUBRIC_V1 },
      { role: "user", content },
    ],
  };
}

const ChatResponse = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z.unknown().optional(),
  x_0g_trace: z
    .object({
      request_id: z.string().optional(),
      provider: z.string().optional(),
      tee_verified: z.boolean().nullable().optional(),
      billing: z.unknown().optional(),
    })
    .optional(),
});

export type ZgCallResult = {
  model: string;
  rawOutput: string;
  requestId: string | null;
  provider: string | null;
  teeVerified: boolean | null;
  billing: unknown;
  /** ZG-Res-Key response header: the chat ID for independent TEE checks. */
  chatId: string | null;
  usage: unknown;
};

/** Network failure, timeout or non-2xx. `retryable` is false for 4xx other than 408/429. */
export class ZgRouterError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ZgRouterError";
  }
}

export async function callRouter(cfg: RouterConfig, request: InspectionRequest, timeoutMs = 30_000): Promise<ZgCallResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${cfg.routerUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.apiKey}`,
          "content-type": "application/json",
          "x-0g-provider-trust-mode": cfg.trustMode,
        },
        body: JSON.stringify(request),
      },
      timeoutMs,
    );
  } catch (err) {
    throw new ZgRouterError(`0G Router unreachable: ${(err as Error).message}`, true);
  }
  if (!res.ok) {
    const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new ZgRouterError(`0G Router returned ${res.status}: ${detail}`, retryable, res.status);
  }
  const parsed = ChatResponse.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ZgRouterError("0G Router response has an unexpected shape", true);

  const body = parsed.data;
  const trace = body.x_0g_trace;
  return {
    model: body.model ?? request.model,
    rawOutput: body.choices[0]?.message.content ?? "",
    requestId: trace?.request_id ?? null,
    provider: trace?.provider ?? null,
    teeVerified: trace?.tee_verified ?? null,
    billing: trace?.billing ?? null,
    chatId: res.headers.get("zg-res-key"),
    usage: body.usage ?? null,
  };
}
