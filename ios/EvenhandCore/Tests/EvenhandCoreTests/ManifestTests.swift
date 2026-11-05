import CryptoKit
import Foundation
import Testing
@testable import EvenhandCore

/// packages/shared/fixtures, shared with the server tests.
private let fixtures = URL(filePath: #filePath).deletingLastPathComponent()
    .appending(path: "../../../../packages/shared/fixtures").standardized

private func fixture(_ name: String) throws -> Data {
    try Data(contentsOf: fixtures.appending(path: name))
}

@Suite("Shared manifest fixture")
struct FixtureTests {
    @Test("canonicalizes manifest.json to manifest.canonical.txt byte for byte")
    func canonicalMatchesFixture() throws {
        let value = try JSONValue(parsing: fixture("manifest.json"))
        #expect(value.canonicalData == (try fixture("manifest.canonical.txt")))
    }

    @Test("a Manifest built in code produces the same bytes and onchain hash")
    func manifestModelMatchesFixture() throws {
        guard case .object(let m) = try JSONValue(parsing: fixture("manifest.json")),
              case .string(let rentalId) = m["rentalId"], case .array(let shots) = m["shots"] else {
            Issue.record("fixture shape changed")
            return
        }
        let parsedShots: [Shot] = shots.compactMap {
            guard case .object(let s) = $0, case .string(let angle) = s["angle"], case .string(let sha) = s["sha256"],
                  case .int(let w) = s["width"], case .int(let h) = s["height"], let a = Angle(rawValue: angle) else { return nil }
            return Shot(angle: a, sha256: sha, width: w, height: h)
        }
        let manifest = Manifest(
            rentalId: rentalId, phase: .pickup, role: .owner, deviceKeyId: "dk_fixture",
            capturedAt: ISO8601DateFormatter().date(from: "2026-11-06T10:15:00Z")!, appBuild: "ios/1.0.0+1", shots: parsedShots
        )
        #expect(manifest.isComplete)
        #expect(manifest.canonicalBytes == (try fixture("manifest.canonical.txt")))
        #expect(manifest.manifestHash == String(decoding: try fixture("manifest.sha256.txt"), as: UTF8.self))
    }
}

@Suite("RFC 8785 details")
struct CanonicalTests {
    @Test("sorts keys by UTF-16 code units and escapes like JSON.stringify")
    func escapingAndOrder() {
        let v = JSONValue.object([
            "z": .int(1),
            "\u{e9}": .int(2),
            "a": .string("x/y\"\n\u{01}\u{e9}"),
            "b": .array([.bool(true), .null, .int(-7)]),
        ])
        #expect(v.canonicalString == "{\"a\":\"x/y\\\"\\n\\u0001\u{e9}\",\"b\":[true,null,-7],\"z\":1,\"\u{e9}\":2}")
    }

    @Test("rejects fractional numbers")
    func integersOnly() {
        #expect(throws: CanonicalJSONError.self) { try JSONValue(parsing: Data("{\"w\":1.5}".utf8)) }
    }
}

@Suite("Signing")
struct SigningTests {
    @Test("a P-256 signature over the canonical bytes verifies with the SPKI key")
    func signVerify() throws {
        let signer = SoftwareSigner()
        let bytes = try fixture("manifest.canonical.txt")
        let der = try signer.sign(bytes)
        let key = try P256.Signing.PublicKey(derRepresentation: signer.publicKeySPKI)
        #expect(key.isValidSignature(try P256.Signing.ECDSASignature(derRepresentation: der), for: bytes))
        #expect(!key.isValidSignature(try P256.Signing.ECDSASignature(derRepresentation: der), for: bytes + Data([0x20])))
    }

    @Test("shot hashes are lowercase hex SHA-256 of the JPEG bytes")
    func shotHash() {
        let shot = Shot(angle: .top, jpeg: Data("abc".utf8), width: 1, height: 1)
        #expect(shot.sha256 == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }
}
