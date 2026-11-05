// POST /rentals, GET /rentals/:id, GET /rentals?owner=, GET /payment-config, POST /rentals/:id/fund.
import { Address, CreateRentalBody, FundBody, receiveWithAuthorizationTypes } from "@evenhand/shared";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { recoverTypedDataAddress, serializeSignature } from "viem";
import type { Hex } from "../config.js";
import { parseJson } from "../http.js";
import { buildRentalView } from "../rentals/view.js";
import { randomNonce, rentalIdFor, termsFor, unixSeconds } from "../rentals/terms.js";
import type { RouteDeps } from "../app.js";
import { JSON_LIMIT, mustRental, rentalIdParam } from "./common.js";

const MIN_LEAD_S = 5 * 60;
const MIN_VALIDITY_S = 60;

export function rentalRoutes(app: Hono, deps: RouteDeps): void {
  const { repo, chain } = deps;
  const nowS = () => Math.floor((deps.clock ?? Date.now)() / 1000);
  const funding = new Set<string>();

  app.post("/rentals", JSON_LIMIT, async (c) => {
    const body = await parseJson(c, CreateRentalBody);
    if (unixSeconds(body.returnBy) < nowS() + MIN_LEAD_S) throw new HTTPException(400, { message: "returnBy must be at least 5 minutes ahead" });
    const owner = body.ownerAddress.toLowerCase() as Hex;
    const renter = body.renterAddress?.toLowerCase() as Hex | undefined;
    const nonce = randomNonce();
    const id = rentalIdFor(owner, renter, nonce);
    const terms = termsFor(body);
    repo.insertRental(
      { id, item: body.item, owner, renter: renter ?? null, deposit: body.depositUsdt, returnBy: body.returnBy, scheduleBps: body.scheduleBps, termsHash: terms.hash, nonce },
      terms.json,
    );
    let txHash: Hex | undefined;
    if (renter && chain.ready) {
      txHash = await chain.createRental({
        id,
        owner,
        renter,
        deposit: BigInt(body.depositUsdt),
        returnBy: unixSeconds(body.returnBy),
        scheduleBps: body.scheduleBps,
        termsHash: terms.hash,
      });
      repo.addTx(id, "createRental", txHash);
      repo.markOnchain(id);
    }
    return c.json({ rentalId: id, payUrl: `${deps.publicBaseUrl}/pay/${id}`, ...(txHash && { txHash }) });
  });

  app.get("/rentals", (c) => {
    const owner = Address.safeParse(c.req.query("owner"));
    if (!owner.success) throw new HTTPException(400, { message: "owner query must be an address" });
    const views = repo.listRentals({ owner: owner.data }).map((r) => buildRentalView(repo, deps.publicBaseUrl, r.id));
    return c.json(views);
  });

  app.get("/rentals/:id", (c) => {
    const view = buildRentalView(repo, deps.publicBaseUrl, rentalIdParam(c));
    if (!view) throw new HTTPException(404, { message: "rental not found" });
    return c.json(view);
  });

  app.get("/payment-config", async (c) => c.json(await chain.paymentConfig()));

  app.post("/rentals/:id/fund", JSON_LIMIT, async (c) => {
    const id = rentalIdParam(c);
    const body = await parseJson(c, FundBody);
    const rental = mustRental(repo, id);
    const from = body.from.toLowerCase() as Hex;
    if (rental.state !== "None") throw new HTTPException(409, { message: "rental is already funded" });
    if (funding.has(id)) throw new HTTPException(409, { message: "funding already in progress" });
    if (rental.renter && rental.renter !== from) throw new HTTPException(400, { message: "from is not this rental's renter" });
    const validAfter = BigInt(body.validAfter);
    const validBefore = BigInt(body.validBefore);
    if (validAfter > BigInt(nowS())) throw new HTTPException(400, { message: "authorization is not valid yet" });
    if (validBefore < BigInt(nowS() + MIN_VALIDITY_S)) throw new HTTPException(400, { message: "authorization expires too soon" });

    const cfg = await chain.paymentConfig();
    const deposit = BigInt(rental.deposit);
    const signer = await recoverTypedDataAddress({
      domain: cfg.domain as never,
      types: receiveWithAuthorizationTypes,
      primaryType: "ReceiveWithAuthorization",
      message: { from, to: cfg.depositsAddress as Hex, value: deposit, validAfter, validBefore, nonce: body.nonce as Hex },
      signature: serializeSignature({ r: body.r as Hex, s: body.s as Hex, v: BigInt(body.v) }),
    });
    if (signer.toLowerCase() !== from) throw new HTTPException(400, { message: "authorization is not signed by from for this deposit" });
    if ((await chain.usdtBalance(from)) < deposit) throw new HTTPException(400, { message: "USDT balance is below the deposit" });

    funding.add(id);
    try {
      if (!rental.onchain) {
        if (!rental.renter) repo.setRenter(id, from);
        const createTx = await chain.createRental({
          id: id as Hex,
          owner: rental.owner as Hex,
          renter: from,
          deposit,
          returnBy: unixSeconds(rental.returnBy),
          scheduleBps: rental.scheduleBps,
          termsHash: rental.termsHash as Hex,
        });
        repo.addTx(id, "createRental", createTx);
        repo.markOnchain(id);
      }
      const txHash = await chain.fund(id as Hex, { validAfter, validBefore, nonce: body.nonce as Hex, v: body.v, r: body.r as Hex, s: body.s as Hex });
      repo.addTx(id, "fundWithAuthorization", txHash);
      repo.setState(id, "Funded");
      return c.json({ txHash });
    } finally {
      funding.delete(id);
    }
  });
}
