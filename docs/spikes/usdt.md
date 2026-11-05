# USDT spike (C1a), checked on Whitechain testnet (chain 1874), 6 Nov 2026

- Token `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`: EIP-1967 proxy to `0x26425662D126412128967ECf0a02EC48573026F7` (TetherTokenV2).
- `name()` = "Tether USD", `decimals()` = 6.
- EIP-712 domain that matches `DOMAIN_SEPARATOR()`: `{ name: "Tether USD", version: "1", chainId: 1874, verifyingContract: token }` (auto-detected by the server: `GET /payment-config`, and by `pnpm -C server preflight`).
- Implementation bytecode has `receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)` (the overload the contract calls), the `bytes signature` overload, `transferWithAuthorization` and `authorizationState(address,bytes32)`.
- Pull logic proven on anvil with an EIP-3009 mock (`sh scripts/anvil-e2e.sh`). PENDING: the first real pull on 1874 (needs a deployed contract, WBT for the relayer, test USDT for the renter); add its explorer link here.
