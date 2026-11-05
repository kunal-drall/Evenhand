import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

/** Parses the JSON body with a zod schema; throws 400 with a readable message on failure. */
export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "body must be JSON" });
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new HTTPException(400, { message: z.prettifyError(result.error) });
  return result.data;
}
