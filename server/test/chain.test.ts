import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, keccak256, parseAbiParameters, toHex } from "viem";
import { matchDomain } from "../src/chain/port.js";
import { assertAllowed, createSendTx, TxRefusedError } from "../src/chain/sendTx.js";

describe("sendTx allowlist", () => {
  it("lets each key call only its own functions", () => {
    for (const fn of ["createRental", "recordPickup", "recordReturn", "proposeVerdict"]) expect(() => assertAllowed("inspector", fn)).not.toThrow();
    for (const fn of ["fundWithAuthorization", "finalize", "refundOnTimeout"]) expect(() => assertAllowed("relayer", fn)).not.toThrow();
    expect(() => assertAllowed("inspector", "finalize")).toThrow(TxRefusedError);
    expect(() => assertAllowed("relayer", "proposeVerdict")).toThrow(TxRefusedError);
  });

  it("refuses functions outside the allowlist and unknown roles", () => {
    for (const fn of ["waive", "appeal", "resolveAppeal", "setTeeSigner", "transfer"]) {
      expect(() => assertAllowed("inspector", fn)).toThrow(TxRefusedError);
      expect(() => assertAllowed("relayer", fn)).toThrow(TxRefusedError);
    }
    expect(() => assertAllowed("arbiter", "resolveAppeal")).toThrow(TxRefusedError);
  });

  it("refuses before touching the network, and when gas exceeds the cap", async () => {
    const client = {
      simulateContract: vi.fn().mockResolvedValue({}),
      estimateContractGas: vi.fn().mockResolvedValue(900_000n),
      waitForTransactionReceipt: vi.fn(),
    };
    const wallet = { account: { address: "0x1" }, writeContract: vi.fn() };
    const sendTx = createSendTx(client as never, { inspector: wallet as never }, "0x00000000000000000000000000000000000000aa");
    expect(() => sendTx("inspector", "finalize" as never, [])).toThrow(TxRefusedError);
    expect(client.simulateContract).not.toHaveBeenCalled();
    await expect(sendTx("inspector", "recordPickup", ["0x", "0x"])).rejects.toThrow(/above the 500000 cap/);
    expect(wallet.writeContract).not.toHaveBeenCalled();
    await expect(sendTx("relayer", "finalize", ["0x"])).rejects.toThrow(/relayer key is not configured/);
  });

  it("sends with the deposits contract as the only target", async () => {
    const target = "0x00000000000000000000000000000000000000aa";
    const client = {
      simulateContract: vi.fn().mockResolvedValue({}),
      estimateContractGas: vi.fn().mockResolvedValue(100_000n),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", logs: [] }),
    };
    const wallet = { account: { address: "0x1" }, writeContract: vi.fn().mockResolvedValue("0xhash") };
    const sendTx = createSendTx(client as never, { relayer: wallet as never }, target);
    const { hash } = await sendTx("relayer", "finalize", [`0x${"11".repeat(32)}`]);
    expect(hash).toBe("0xhash");
    expect(wallet.writeContract.mock.calls[0]?.[0]).toMatchObject({ address: target, functionName: "finalize", gas: 120_000n });
  });
});

describe("EIP-712 domain detection", () => {
  const token = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
  const h = (s: string) => keccak256(toHex(s));
  const separator = (version: string) =>
    keccak256(
      encodeAbiParameters(parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"), [
        h("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
        h("Tether USD"),
        h(version),
        1874n,
        token,
      ]),
    );

  it("finds version 1 or 2 by matching DOMAIN_SEPARATOR", () => {
    expect(matchDomain("Tether USD", separator("1"), 1874, token)).toEqual({ name: "Tether USD", version: "1", chainId: 1874, verifyingContract: token });
    expect(matchDomain("Tether USD", separator("2"), 1874, token)?.version).toBe("2");
    expect(matchDomain("Tether USD", separator("1"), 1, token)).toBeUndefined();
  });
});
