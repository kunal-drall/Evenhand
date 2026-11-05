# Evenhand

Neutral inspector for rental deposits. Owner and renter scan an item with a phone at pickup and return; a sealed 0G vision model judges new damage; a Whitechain contract holding the USDT deposit settles by the verdict. ETHGlobal Mumbai 2026, built from scratch. Partner prizes: 0G (Physical AI) and Whitechain (Operate, Scale).

## Read only what the task needs
1. This file (already loaded).
2. `docs/interfaces.md` — the only spec. Read the section your task names, not the whole file.
3. Files inside the folder your task names.
Do not read `docs/ai/PRD.md` unless the human asks: it is for humans and for the AI-use disclosure.

## Layout
- `contracts/` Foundry, Solidity ^0.8.24, OpenZeppelin 5
- `server/` Node 22, TypeScript (strict, ESM), Hono, viem, zod, better-sqlite3, sharp, canonicalize, @0gfoundation/0g-storage-ts-sdk
- `web/` Vite + React + TypeScript + viem; `web/sdk/` is the drop-in SDK
- `ios/` SwiftUI, iOS 17+, CryptoKit, AVFoundation; no third-party packages
- `packages/shared/` zod schemas, ABI, constants, `deployments.json`
- `docs/` `interfaces.md`, `ai/` (PRD, prompts, AI_USAGE.md), `spikes/`
- pnpm workspace at the root

## Commands
- Contracts: `cd contracts && forge build && forge test --match-contract <Name> -q`
- Server: `pnpm -C server typecheck`, `pnpm -C server test -- <file>`, `pnpm -C server dev`
- Web: `pnpm -C web build`, `pnpm -C web dev`
- Shared: `pnpm -C packages/shared build`
- iOS: the human builds and runs in Xcode on a real iPhone (Secure Enclave and camera do not work in the simulator). Claude edits Swift files only.

## Conventions
- Validate every external input with zod (server) or custom errors (contracts).
- Every network call has a timeout. If 0G fails, stop: never invent or default a verdict.
- Secrets only in `.env` (gitignored). Never print, log or commit keys.
- Amounts: USDT base units as strings in JSON, `bigint` in TS, `uint96` onchain. Read decimals at runtime.
- Keep functions small; no new dependency without a one-line reason in the commit message.
- Commit after each green step: `<area>: <what changed>`.
- After finishing a chunk, append one line to `docs/ai/AI_USAGE.md`: date, chunk ID, files written by AI, agent used.

## Token discipline (follow strictly)
- Run only the tests for the file you changed; never the whole suite unless asked.
- Long output: pipe through `| tail -40`. Never paste ABIs, logs, JSON blobs or images into the conversation; reference paths.
- Search inside the task's folder only (`rg -n <term> server/src`), never the whole repo.
- No web browsing unless the task says so. Facts you need are in `docs/interfaces.md`.
- When unsure about a spec detail, stop and ask the human in one line instead of exploring.
- Finish with a summary of at most 10 lines: what changed, tests run, anything blocked.

## Requirements the code must never break
- 0G: a 0G call decides every verdict; every decision logged to 0G Storage with its `request_id`; safe stop when 0G is unreachable.
- Whitechain: contracts verified on chain 1874; deposits paid in USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`; renter never pays gas.
- Contract never sends funds to anyone except a rental's owner and renter.

## Compact instructions
When compacting, keep: current chunk ID, files changed, failing tests with their error lines, deployed addresses, open TODOs. Drop: exploration, passing test output, file contents already committed.
