import { randomBytes } from "node:crypto";
import canonicalize from "canonicalize";
import { encodeAbiParameters, keccak256, parseAbiParameters, toHex, zeroAddress } from "viem";
import type { CreateRentalBody } from "@evenhand/shared";
import type { Hex } from "../config.js";

export const randomNonce = (): Hex => toHex(randomBytes(32));

/**
 * docs/interfaces.md section 4: keccak256(abi.encode(owner, renter, nonce)).
 * When the renter is not known yet, address(0) stands in; the random nonce keeps IDs unique.
 */
export function rentalIdFor(owner: Hex, renter: Hex | undefined, nonce: Hex): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("address, address, bytes32"), [owner, renter ?? zeroAddress, nonce]));
}

/** Terms committed onchain as termsHash: keccak256 of the RFC 8785 canonical terms JSON. */
export function termsFor(body: CreateRentalBody): { json: string; hash: Hex } {
  const json = canonicalize({
    v: 1,
    item: body.item,
    owner: body.ownerAddress.toLowerCase(),
    deposit: body.depositUsdt,
    returnBy: body.returnBy,
    scheduleBps: body.scheduleBps,
  });
  if (!json) throw new Error("terms are not canonicalizable");
  return { json, hash: keccak256(toHex(json)) };
}

export const unixSeconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
