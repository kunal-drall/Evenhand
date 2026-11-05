// Vision model discovery on the 0G Router (docs/interfaces.md section 8, "Model choice").
import { z } from "zod";
import { fetchWithTimeout } from "../net.js";

const ModelEntry = z.object({
  id: z.string(),
  architecture: z
    .object({ input_modalities: z.array(z.string()), output_modalities: z.array(z.string()) })
    .optional(),
  supported_parameters: z.array(z.string()).optional(),
  pricing_usd: z.object({ prompt: z.string().optional(), completion: z.string().optional() }).optional(),
});
const ModelList = z.object({ data: z.array(ModelEntry) });

export type VisionModel = {
  id: string;
  promptUsdPerToken: number;
  completionUsdPerToken: number;
  /** Supports response_format, which the inspection request sends. */
  jsonMode: boolean;
};

/** A "stronger" second-pass model must cost at least this many times the first pass per input token. */
export const STRONG_PRICE_FACTOR = 5;

const usd = (s: string | undefined) => (s === undefined ? Number.POSITIVE_INFINITY : Number(s));

/** Image-in, text-out models, cheapest input price first. */
export function toVisionModels(raw: unknown): VisionModel[] {
  const { data } = ModelList.parse(raw);
  return data
    .filter((m) => m.architecture?.input_modalities.includes("image") && m.architecture.output_modalities.includes("text"))
    .map((m) => ({
      id: m.id,
      promptUsdPerToken: usd(m.pricing_usd?.prompt),
      completionUsdPerToken: usd(m.pricing_usd?.completion),
      jsonMode: m.supported_parameters?.includes("response_format") ?? false,
    }))
    .sort((a, b) => a.promptUsdPerToken - b.promptUsdPerToken);
}

export async function listVisionModels(routerUrl: string, timeoutMs = 15_000): Promise<VisionModel[]> {
  const res = await fetchWithTimeout(`${routerUrl}/models`, { method: "GET" }, timeoutMs);
  if (!res.ok) throw new Error(`GET /models returned ${res.status}`);
  return toVisionModels(await res.json());
}

/**
 * First pass: env override, else the cheapest JSON-mode vision model.
 * Second pass: env override, else the cheapest JSON-mode model at least STRONG_PRICE_FACTOR times pricier.
 */
export function pickModels(
  models: VisionModel[],
  overrides: { first?: string | undefined; strong?: string | undefined } = {},
): { first: VisionModel; strong: VisionModel | undefined } {
  const byId = (id: string) => {
    const m = models.find((x) => x.id === id);
    if (!m) throw new Error(`model ${id} is not an image-capable model on the router`);
    return m;
  };
  const json = models.filter((m) => m.jsonMode);
  const first = overrides.first ? byId(overrides.first) : json[0];
  if (!first) throw new Error("no JSON-mode vision model available on the router");
  const strong = overrides.strong
    ? byId(overrides.strong)
    : json.find((m) => m.promptUsdPerToken >= first.promptUsdPerToken * STRONG_PRICE_FACTOR);
  return { first, strong };
}
