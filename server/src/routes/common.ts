import { Bytes32 } from "@evenhand/shared";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { RentalRow, Repo } from "../rentals/repo.js";

export const JSON_LIMIT = bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "body too large" }, 413) });
/** Six phone JPEGs plus the manifest. */
export const SCAN_LIMIT = bodyLimit({ maxSize: 60 * 1024 * 1024, onError: (c) => c.json({ error: "scan upload too large" }, 413) });

export function rentalIdParam(c: Context): string {
  const id = Bytes32.safeParse(c.req.param("id"));
  if (!id.success) throw new HTTPException(400, { message: "rental id must be 32-byte hex" });
  return id.data.toLowerCase();
}

export function mustRental(repo: Repo, id: string): RentalRow {
  const rental = repo.getRental(id);
  if (!rental) throw new HTTPException(404, { message: "rental not found" });
  return rental;
}
