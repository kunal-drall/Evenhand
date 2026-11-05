// POST /rentals, GET /rentals/:id, GET /rentals?owner= | ?queue=arbiter, GET /payment-config, POST /rentals/:id/fund.
import { Address, CreateRentalBody, FundBody, fundingNonce, receiveWithAuthorizationTypes } from "@evenhand/shared";
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { recoverTypedDataAddress, serializeSignature } from "viem";
import type { RouteDeps } from "../app.js";
import type { Hex } from "../config.js";
import { getDevice } from "../devices.js";
import { parseJson } from "../http.js";
import { operatorOnly } from "../ratelimit.js";
import { buildRentalView } from "../rentals/view.js";
import { randomNonce, rentalIdFor, termsFor, unixSeconds } from "../rentals/terms.js";
import { JSON_LIMIT, mustRental, rentalIdParam } from "./common.js";

const MIN_LEAD_S = 5 * 60;
/** The authorization must stay valid long enough for createRental + fund to mine. */
const MIN_VALIDITY_S = 10 * 60;

export function rentalRoutes(app: Hono, deps: RouteDeps): void {
  const { repo, chain } = deps;
  const nowS = () => Math.floor((deps.clock ?? Date.now)() / 1000);
  const view = (id: string) => buildRentalView(repo, deps.publicBaseUrl, id, deps.photoTokens.tokenFor);

  // No gas is spent here: createRental is sent at funding, once a valid, funded authorization arrives.
  app.post("/rentals", JSON_LIMIT, async (c) => {
    const body = await parseJson(c, CreateRentalBody);
    if (unixSeconds(body.returnBy) < nowS() + MIN_LEAD_S) throw new HTTPException(400, { message: "returnBy must be at least 5 minutes ahead" });
    if (body.ownerDeviceKeyId && getDevice(repo.db, body.ownerDeviceKeyId)?.role !== "owner") {
      throw new HTTPException(400, { message: "ownerDeviceKeyId is not a registered owner device" });
    }
    const owner = body.ownerAddress.toLowerCase() as Hex;
    const renter = body.renterAddress?.toLowerCase() as Hex | undefined;
    if (renter === owner) throw new HTTPException(400, { message: "owner and renter must differ" });
    const nonce = randomNonce();
    const id = rentalIdFor(owner, renter, nonce);
    const terms = termsFor(body);
    repo.insertRental(
      {
        id,
        item: body.item,
        owner,
        renter: renter ?? null,
        deposit: body.depositUsdt,
        returnBy: body.returnBy,
        scheduleBps: body.scheduleBps,
        termsHash: terms.hash,
        nonce,
        ownerDevice: body.ownerDeviceKeyId ?? null,
      },
      terms.json,
    );
    return c.json({ rentalId: id, payUrl: `${deps.publicBaseUrl}/pay/${id}` });
  });

  // ?owner=0x.. for the owner dashboard; ?queue=arbiter for rentals waiting on a human. Operator token required.
  app.get("/rentals", operatorOnly(deps.operatorToken), (c) => {
    if (c.req.query("queue") === "arbiter") {
      const waiting = repo.listRentals().filter((r) => r.state === "Appealed" || repo.getInspection(r.id)?.status === "needs_human");
      return c.json(waiting.map((r) => view(r.id)));
    }
    const owner = Address.safeParse(c.req.query("owner"));
    if (!owner.success) throw new HTTPException(400, { message: "owner query must be an address, or queue=arbiter" });
    return c.json(repo.listRentals({ owner: owner.data }).map((r) => view(r.id)));
  });

  app.get("/rentals/:id", (c) => {
    const v = view(rentalIdParam(c));
    if (!v) throw new HTTPException(404, { message: "rental not found" });
    return c.json(v);
  });

  app.get("/payment-config", async (c) => c.json(await chain.paymentConfig()));

  app.post("/rentals/:id/fund", JSON_LIMIT, async (c) => {
    const id = rentalIdParam(c);
    const body = await parseJson(c, FundBody);
    return deps.lock(id, async () => {
      const rental = mustRental(repo, id);
      const from = body.from.toLowerCase() as Hex;
      if (rental.state !== "None") throw new HTTPException(409, { message: "rental is already funded" });
      if (rental.renter && rental.renter !== from) throw new HTTPException(400, { message: "from is not this rental's renter" });
      if (from === rental.owner) throw new HTTPException(400, { message: "the owner cannot pay their own deposit" });
      const validAfter = BigInt(body.validAfter);
      const validBefore = BigInt(body.validBefore);
      if (validAfter > BigInt(nowS())) throw new HTTPException(400, { message: "authorization is not valid yet" });
      if (validBefore < BigInt(nowS() + MIN_VALIDITY_S)) throw new HTTPException(400, { message: "authorization expires too soon" });

      const cfg = await chain.paymentConfig();
      const nonce = body.nonce.toLowerCase() as Hex;
      if (nonce !== fundingNonce(cfg.depositsAddress as Hex, id as Hex)) throw new HTTPException(400, { message: "authorization nonce is not this rental's funding nonce" });
      const deposit = BigInt(rental.deposit);
      let signer: string;
      try {
        signer = await recoverTypedDataAddress({
          domain: cfg.domain as never,
          types: receiveWithAuthorizationTypes,
          primaryType: "ReceiveWithAuthorization",
          message: { from, to: cfg.depositsAddress as Hex, value: deposit, validAfter, validBefore, nonce },
          signature: serializeSignature({ r: body.r as Hex, s: body.s as Hex, v: BigInt(body.v) }),
        });
      } catch {
        throw new HTTPException(400, { message: "authorization signature is malformed" });
      }
      if (signer.toLowerCase() !== from) throw new HTTPException(400, { message: "authorization is not signed by from for this deposit" });
      if (await chain.authorizationUsed(from, nonce)) throw new HTTPException(400, { message: "authorization nonce was already used" });
      if ((await chain.usdtBalance(from)) < deposit) throw new HTTPException(400, { message: "USDT balance is below the deposit" });

      if (!rental.onchain) {
        const createTx = await chain.createRental({
          id: id as Hex,
          owner: rental.owner as Hex,
          renter: from,
          deposit,
          returnBy: unixSeconds(rental.returnBy),
          scheduleBps: rental.scheduleBps,
          termsHash: rental.termsHash as Hex,
        });
        if (!rental.renter) repo.setRenter(id, from); // only once the renter is fixed onchain
        repo.addTx(id, "createRental", createTx);
        repo.markOnchain(id);
      }
      const txHash = await chain.fund(id as Hex, { validAfter, validBefore, nonce, v: body.v, r: body.r as Hex, s: body.s as Hex });
      repo.addTx(id, "fundWithAuthorization", txHash);
      repo.setState(id, "Funded");
      return c.json({ txHash });
    });
  });
}
