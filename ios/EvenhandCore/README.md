# EvenhandCore (Swift package)

The capture app's logic, without UI: RFC 8785 canonical JSON, the `Manifest` model (docs/interfaces.md section 5), Secure Enclave signing, the laptop angle labels and an async client for the server routes.

- Add to the Xcode app: File > Add Package Dependencies > Add Local… > `ios/EvenhandCore`.
- Signing on the phone: `try SecureEnclaveSigner()` (key created once, handle kept in the Keychain). Register with `APIClient.registerDevice(role: .owner, signer:, label:)`.
- A scan: build `Shot(angle:jpeg:width:height:)` for each `Angle.allCases` from the **exact JPEG bytes you upload**, make a `Manifest`, then `client.uploadScan(manifest, signature: try signer.signatureBase64(for: manifest), photos:)`.
- `inspection.status == "paused"`: show "Inspection paused".

Verified on a Mac (2026-11-06): canonicalizing `packages/shared/fixtures/manifest.json` gives `manifest.canonical.txt` byte for byte, and a `SoftwareSigner` signature verifies with Node's `crypto.verify`, the call the server makes (`swift run fixture-sign <manifest.json>` prints spki/signature/canonical). The Swift Testing suite in `Tests/` runs with `swift test` or in Xcode.
