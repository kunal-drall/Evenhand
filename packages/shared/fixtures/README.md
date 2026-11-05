# Manifest fixture (docs/interfaces.md section 5)

- `manifest.json`: a valid manifest, pretty-printed, keys deliberately not sorted.
- `manifest.canonical.txt`: its RFC 8785 canonical bytes (no trailing newline). This is what gets signed.
- `manifest.sha256.txt`: `0x` + SHA-256 of the canonical bytes, the onchain manifest hash.

Server (`server/test/manifest.test.ts`) and iOS tests both canonicalize `manifest.json` and must produce `manifest.canonical.txt` exactly.
Swift pitfalls: `JSONEncoder` needs `.sortedKeys` and `.withoutEscapingSlashes` (`appBuild` contains a `/`); integers only, no `1.0`.
