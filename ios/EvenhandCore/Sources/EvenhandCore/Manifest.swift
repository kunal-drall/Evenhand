import CryptoKit
import Foundation

/// Capture angles in spec order (docs/interfaces.md section 4). The IDs never change; `laptopLabel` is what the app shows.
public enum Angle: String, CaseIterable, Sendable, Codable {
    case front, back, left, right, top, detail

    /// Laptop shot for each fixed angle ID (plan.md section 2).
    public var laptopLabel: String {
        switch self {
        case .front: "Screen, showing a full white page"
        case .back: "Base (underside)"
        case .left: "Left side"
        case .right: "Right side"
        case .top: "Lid"
        case .detail: "Keyboard and palm rest"
        }
    }
}

public enum Phase: String, Sendable, Codable { case pickup, `return` }
public enum Role: String, Sendable, Codable { case owner, renter }

public struct Shot: Equatable, Sendable {
    public let angle: Angle
    /// Lowercase hex SHA-256 of the exact JPEG bytes that are uploaded.
    public let sha256: String
    public let width: Int
    public let height: Int

    public init(angle: Angle, jpeg: Data, width: Int, height: Int) {
        self.angle = angle
        self.sha256 = Manifest.hex(SHA256.hash(data: jpeg))
        self.width = width
        self.height = height
    }

    public init(angle: Angle, sha256: String, width: Int, height: Int) {
        self.angle = angle
        self.sha256 = sha256
        self.width = width
        self.height = height
    }
}

/// docs/interfaces.md section 5. Signed as RFC 8785 canonical bytes; its SHA-256 is the onchain manifest hash.
public struct Manifest: Equatable, Sendable {
    public let rentalId: String
    public let phase: Phase
    public let role: Role
    public let deviceKeyId: String
    public let capturedAt: Date
    public let appBuild: String
    /// Exactly six, in `Angle.allCases` order.
    public let shots: [Shot]

    public init(rentalId: String, phase: Phase, role: Role, deviceKeyId: String, capturedAt: Date, appBuild: String, shots: [Shot]) {
        self.rentalId = rentalId
        self.phase = phase
        self.role = role
        self.deviceKeyId = deviceKeyId
        self.capturedAt = capturedAt
        self.appBuild = appBuild
        self.shots = shots
    }

    /// The server rejects anything else; check before uploading.
    public var isComplete: Bool { shots.map(\.angle) == Angle.allCases }

    public var json: JSONValue {
        .object([
            "v": .int(1),
            "rentalId": .string(rentalId),
            "phase": .string(phase.rawValue),
            "role": .string(role.rawValue),
            "deviceKeyId": .string(deviceKeyId),
            "capturedAt": .string(Manifest.isoUTC(capturedAt)),
            "appBuild": .string(appBuild),
            "shots": .array(shots.map {
                .object(["angle": .string($0.angle.rawValue), "sha256": .string($0.sha256), "width": .int($0.width), "height": .int($0.height)])
            }),
        ])
    }

    public var canonicalBytes: Data { json.canonicalData }

    /// "0x" + SHA-256 of the canonical bytes: the value recorded onchain.
    public var manifestHash: String { "0x" + Manifest.hex(SHA256.hash(data: canonicalBytes)) }

    /// ISO 8601 UTC with whole seconds, e.g. 2026-11-06T10:15:00Z.
    public static func isoUTC(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: date)
    }

    static func hex<D: Sequence>(_ digest: D) -> String where D.Element == UInt8 {
        digest.map { String(format: "%02x", $0) }.joined()
    }
}
