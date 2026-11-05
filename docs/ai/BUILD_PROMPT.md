# Evenhand — Claude Code build prompt

How the three of you build Evenhand with Claude Code in about 30 hours without burning tokens. The PRD (the doc "Evenhand — Product Requirements") says *what*; this file says *who builds what, in which order, with which prompt*.

---

## 0. One-time setup (humans, 20 minutes, tonight)

1. Create the repo, copy everything in this kit into its root, commit: `chore: build kit`.
   - `CLAUDE.md`, `.claude/agents/*`, `.claude/settings.json`, `.claude/hooks/filter-output.sh`, `docs/interfaces.md`, `docs/ai/AI_USAGE.md`.
   - Export the PRD doc as Markdown to `docs/ai/PRD.md` and keep this file at `docs/ai/BUILD_PROMPT.md` (ETHGlobal requires prompts and specs in the repo).
   - `chmod +x .claude/hooks/filter-output.sh` and check `jq` is installed (`brew install jq`).
2. Keys and money (do these first; faucets throttle):
   - Five fresh EVM keys: deployer, inspector, relayer, arbiter, test renter. Put them in `.env` (never commit).
   - Test WBT from `https://faucet.testnet.whitechain.io` to deployer, inspector, relayer.
   - Test USDT to the test renter (ask at the Whitechain booth if the faucet does not give USDT).
   - 0G Galileo test tokens from `https://faucet.0g.ai` to the storage key; a 0G Router inference key (`sk-…`) from `https://pc.0g.ai` (ask the 0G booth for hackathon credits).
3. Apple: the Swift developer registers both iPhones in the developer portal and creates the app ID. Camera usage string in Info.plist.
4. A public URL for the server so phones can reach it (for example `cloudflared tunnel --url http://localhost:8787`). Put it in `PUBLIC_BASE_URL`.

## 1. Rules that keep token spend low (read once, follow always)

These follow Claude Code's own cost and caching docs.

1. **Pick the model and effort at the start of a session and do not change them mid-task.** Each model has its own prompt cache; a switch makes the next turn re-read the whole conversation uncached. Main sessions run on `sonnet`. Heavier work goes to a subagent that already has its own model (the `contracts` and `reviewer` agents use `opus`; `docs` uses `haiku`).
2. **One chunk per session.** When a chunk is committed, run `/clear` (free) before the next one. Use `/compact <what to keep>` only at a natural break, never mid-debug. To abandon a wrong path, use `/rewind`, which returns to an already-cached prefix.
3. **Do not edit `CLAUDE.md` mid-session.** It is read once at start; edits only apply after `/clear`. Keep it under 200 lines (it is about 60).
4. **Do not connect MCP servers or toggle plugins mid-session.** It can invalidate the cache. Use CLI tools (`forge`, `cast`, `pnpm`, `gh`) instead of MCP servers.
5. **Give specific prompts with a "done when".** Every chunk prompt below names the files, the spec section and the test. Never ask Claude to "explore the repo".
6. **Delegate noisy work to subagents** (tests, deploy logs, docs). Only their short summary returns to the main conversation.
7. **Let the hook filter output.** `.claude/hooks/filter-output.sh` cuts test, typecheck and build output down to failures and summaries before Claude reads it.
8. **No screenshots in Claude Code.** Images accumulate in context and force uncached re-reads when evicted. Describe UI problems in words; paste compiler errors as text.
9. **No agent teams.** Claude Code's docs put them at roughly seven times the tokens of a normal session in plan mode. Three humans each running one session is the parallelism.
10. **Plan mode only for chunks C1 and C4**, the two where a wrong design costs a rewrite.
11. **Watch `/usage`.** The `Prompt cache (main)` line should show most input tokens from cache. If misses climb, something above is being broken.

## 2. Chunk map

| ID | Chunk | Human | Session / agent | Model | Needs | Priority | Done when |
|---|---|---|---|---|---|---|---|
| C0 | Scaffold monorepo, shared schemas, stub routes | Kunal | main | sonnet | — | P0 | `pnpm -r build` and `forge build` pass |
| C1a | USDT authorization spike | Solidity dev | `contracts` | opus | C0 | P0 | Explorer link of a `receiveWithAuthorization` pull |
| C2 | 0G spike: model list, one vision call, one storage upload | Kunal | main | sonnet | C0 | P0 | `request_id`, `tee_verified`, billing and a storage root printed |
| C3a | Capture spike: one photo, Secure Enclave signature, server verifies | Swift dev | `ios` | sonnet | C0 | P0 | `POST /debug/verify-manifest` returns ok |
| C1 | `EvenhandDeposits` + tests + deploy + verify | Solidity dev | `contracts` | opus | C1a | P0 | All P0 transitions tested; verified on explorer |
| C4 | Server: API, inspector, rules, storage log, relayer, safe stop | Kunal | `server` | sonnet | C1 ABI, C2 | P0 | Unit tests pass; one real inspection proposes a verdict |
| C3 | iOS app: capture flow, rentals, verdict view | Swift dev | `ios` | sonnet | C3a, C4 routes | P0 | Owner completes pickup and return on a real iPhone |
| C5 | Web: pay page, confirm, status, owner dashboard | Kunal | `web` | sonnet | C4 | P0 | Renter pays without seeing gas or chain names |
| C6 | End-to-end on testnet; fix; record links | All | main | sonnet | C1, C3, C4, C5 | P0 | Real scratch settles 35%; smudge settles 0%; 0G cut shows paused |
| C7a | TEE signature check (contract + server) | Solidity dev + Kunal | `contracts`, `server` | opus / sonnet | C6, C2 finding | P1 | Settlement rejects a wrong TEE signature |
| C7b | Appeal and arbiter flow, CSV export, SDK + demo shop | Kunal | `server`, `web` | sonnet | C6 | P1 | Appeal resolves; `/shop` uses only the SDK |
| C7c | QR tag check, replay script | Swift dev + Kunal | `ios`, `server` | sonnet | C6 | P1 | Shot without tag rejected; replay prints same decision |
| C8 | Fresh-eyes review | Solidity dev | `reviewer` | opus | C6 | P0 | Findings fixed or written in README limitations |
| C9 | README, feedback file, AI-use table, submission text | Kunal | `docs` | haiku | C6 | P0 | Every checkbox in the PRD sponsor section ticked |

C1a, C2 and C3a run in parallel right after C0, on three laptops. They are go/no-go tests: if one fails by Friday 03:00, stop and re-plan before building on it.

## 3. Chunk prompts (paste as written; each starts a fresh session or follows `/clear`)

### C0 — scaffold (Kunal, main session, `/model sonnet` before the first message)
```
Read docs/interfaces.md sections 2, 4, 5, 7. Scaffold the pnpm workspace:
- packages/shared: zod schemas for Manifest, Shot, ModelVerdict, InspectionLog, RentalView, request bodies (section 7); constants (section 1, 4); empty abi.ts and deployments.json.
- server: Hono app on port 8787 with GET /health, POST /devices, POST /debug/verify-manifest (verifies a manifest signature per section 5), SQLite file db.ts with tables devices, rentals, scans, inspections. No other routes yet.
- web: Vite + React + TS skeleton with routes /pay/:id, /r/:id, /owner, /shop as placeholders.
- contracts: forge init, OpenZeppelin 5 installed, empty src/EvenhandDeposits.sol.
- root: .gitignore (.env, node_modules, out, cache, *.sqlite), .env.example from section 2, docs/spikes/.
Add a shared fixture test: one manifest JSON and its canonical string, used by server tests now and the iOS test later.
Done when pnpm -r build, pnpm -C server test and forge build pass. Commit "chore: scaffold".
```

### C1a — USDT spike (Solidity dev)
```
Use the contracts agent. Read docs/interfaces.md sections 1 and 6.
Write contracts/script/SpikeReceive.s.sol with a minimal SpikeReceiver contract whose pull(...) calls USDT receiveWithAuthorization(from, address(this), value, validAfter, validBefore, nonce, v, r, s), and a server/scripts/spike-usdt.ts (viem) that: reads USDT name(), decimals(), DOMAIN_SEPARATOR(); builds the EIP-712 domain (try version "1"), checks it matches DOMAIN_SEPARATOR; signs ReceiveWithAuthorization from the test renter key for 1 USDT; calls pull via the relayer key.
Done when a pull succeeds on chain 1874. Write the domain values that worked, decimals and the explorer link to docs/spikes/usdt.md (max 10 lines). Commit.
```

### C2 — 0G spike (Kunal)
```
Read docs/interfaces.md sections 1, 2, 8. Write server/scripts/spike-0g.ts:
1) GET {ZG_ROUTER_URL}/models; print id and price of models whose architecture.input_modalities includes "image" and output is text. Cheapest and one stronger.
2) One chat/completions call exactly as section 8 with RUBRIC_V1, using fixtures/pair/front-pickup.jpg and front-return.jpg only (one angle). Print: parsed JSON, x_0g_trace (request_id, provider, tee_verified, billing), the ZG-Res-Key header, usage tokens.
3) If the 0G compute SDK (@0gfoundation/0g-compute-ts-sdk per 0G's inference docs) lets you run broker.inference.processResponse(provider, chatID) with little setup, run it and print the result; otherwise skip and note why. Do not spend more than 20 minutes on this step.
4) Upload a small JSON file to 0G Storage testnet with @0gfoundation/0g-storage-ts-sdk; print the root hash; download it back and compare.
Done when all values are printed. Write findings to docs/spikes/0g.md (max 15 lines): model IDs, input tokens per image, cost per call, whether tee_verified was true, whether the signed text equals the response content (if checked). Commit.
```

### C3a — capture spike (Swift developer)
```
Use the ios agent. Read docs/interfaces.md section 5. In ios/ create a SwiftUI app with one screen: take one photo with AVFoundation, compute SHA-256, create or load a Secure Enclave P-256 key, build a one-shot manifest (use the shared fixture for canonical JSON), sign it, POST /devices then POST /debug/verify-manifest to PUBLIC_BASE_URL. Show the server's answer on screen.
Also add a unit test that canonicalizes the shared fixture manifest and compares it to the fixture's canonical string.
Done when the human runs it on a real iPhone and the server returns ok. Commit.
```

### C1 — contract (Solidity dev, enter plan mode first: Shift+Tab)
```
Use the contracts agent. Implement EvenhandDeposits exactly per docs/interfaces.md section 3, with the tests listed in the agent file. P1 TEE check: implement setTeeSigner and the check, but leave teeSigner unset at deploy.
Then deploy to Whitechain Sepolia with script/Deploy.s.sol (appealWindow 600 s for the demo, grace 3600 s, autoCapBps 5000, minConfidenceBps 7500), verify on Blockscout, write deployments.json and abi.ts.
Done when tests pass and the explorer shows the verified source. Commit "contracts: EvenhandDeposits v1".
```

### C4 — server (Kunal, plan mode first)
```
Use the server agent. Read docs/interfaces.md sections 2, 5, 7, 8, 9, 10 and packages/shared/src/abi.ts.
Implement all section 7 routes except appeal and export (C7b), the inspector pipeline (prepare -> zg -> rules -> log -> propose), AES-256-GCM photo encryption with 0G Storage upload, the sendTx allowlist, safe stop with retry, and GET /health/0g. Pickup recorded onchain only after owner scan + renter confirm.
Tests: rules (all routes to needs_human), manifest verify (shared fixture), aes round trip, request validation. Mock 0G.
Done when tests pass and scripts/e2e-local.ts (create rental, fake scans from fixtures, real 0G call, propose on testnet) prints the verdict tx link. Commit per step.
```

### C3 — iOS app (Swift developer)
```
Use the ios agent. Build the screens in the agent file against the routes in docs/interfaces.md section 7. Capture six angles in order with outline overlays and retake. Upload as multipart. Verdict view shows per-angle result, capture amount, request ID and transaction links; "Inspection paused" when inspection.status is paused.
Done when the owner completes pickup and return scans on a real iPhone against the running server. Commit per screen.
```

### C5 — web (Kunal)
```
Use the web agent. Build /pay/:id, /r/:id and /owner per the agent file and docs/interfaces.md sections 5, 6, 7. Leave /shop and the SDK for C7b.
Done when, on a phone browser, the renter pays a deposit with one tap and confirms the pickup scan, with no gas, chain name or seed phrase visible. Commit.
```

### C6 — end to end (all, main session)
```
Run the full demo flow on testnet with both phones: create, pay, pickup (both confirm), return with a real scratch, verdict, wait the appeal window, finalize. Then a smudge-only return, then a return with the 0G key removed (expect paused). For each failure, fix the smallest thing in the owning folder and re-run only that step.
Record every tx link, request ID and storage root in docs/spikes/demo-run.md. Commit.
```

### C7a — TEE signature check (P1, only if docs/spikes/0g.md says the signed text is the response content)
```
Contracts agent: confirm the canonical suffix check in proposeVerdict matches docs/interfaces.md section 3; add a test with vm.sign and a real-looking response text.
Server agent: fetch the provider signature for the chat ID, pass teeText and teeSig to proposeVerdict; if unavailable, keep P0 mode.
Arbiter calls setTeeSigner with the provider's signer address. Done when a tampered severity reverts and a correct one settles.
```

### C7b, C7c — P1 features
```
C7b (server + web agents): POST /rentals/:id/appeal, arbiter page with resolveAppeal, GET /export.csv, web/sdk/evenhand.ts and /shop using only the SDK in <= 20 lines.
C7c (ios + server agents): print a QR sticker per rental; require it in each shot (Vision framework barcode detection) and reject at capture; server/scripts/replay.ts re-runs a verdict from its 0G Storage log and prints the same decision.
```

### C8 — review (Solidity dev, fresh session)
```
Use the reviewer agent on the current main branch. Then fix each finding in the owning folder, or add it to README "Known limitations" if it cannot be fixed before the deadline.
```

### C9 — docs and submission (Kunal)
```
Use the docs agent. Write README.md, docs/SUBMISSION.md and tidy docs/ai/AI_USAGE.md from deployments.json, docs/spikes/*.md and docs/spikes/demo-run.md. I will paste my WHITECHAIN_FEEDBACK notes next; format them without adding opinions.
```

## 4. Commit and sync rhythm

- Each person works only in their folders, so there are no merge conflicts. Pull before each chunk, push after.
- `docs/interfaces.md` changes only after all three agree; whoever changes it tells the others to `/clear`.
- Whitechain and ETHGlobal both check for steady commit history; it also protects you if a laptop dies.

## 5. Cut order if time runs short

1. App Attest and iAI sign-in (not in any chunk).
2. Scale track entry.
3. C7c (replay, QR tag).
4. C7a (TEE check): keep the inspector key and say so in the README.
5. C7b SDK and demo shop.

Never cut safe stop, timeout refund or the 0G Storage log.
