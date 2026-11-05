import Foundation

/// Evenhand server API (docs/interfaces.md section 7) for the capture app.
public struct APIClient: Sendable {
    public let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public struct APIError: Error, LocalizedError {
        public let status: Int
        public let message: String
        public var errorDescription: String? { "\(message) (\(status))" }
    }

    // MARK: models (subset of RentalView the app needs)

    public struct RentalView: Decodable, Sendable {
        public let rentalId: String
        public let item: String
        public let owner: String
        public let renter: String?
        public let deposit: String
        public let returnBy: String
        public let state: String
        public let scans: Scans
        public let inspection: Inspection?
        public let txs: [Tx]

        public struct Scans: Decodable, Sendable {
            public let pickup: ScanView?
            public let `return`: ScanView?
        }
        public struct ScanView: Decodable, Sendable {
            public let manifestHash: String
            public let capturedAt: String
            public let photoUrls: [String]
            public let confirmedBy: [String]
        }
        public struct Inspection: Decodable, Sendable {
            /// "running" | "paused" | "done" | "needs_human": show "Inspection paused" for paused.
            public let status: String
            public let verdict: Verdict?
            public let capture: String?
            public let requestId: String?
            public let teeVerified: Bool?
            public let inspectionRoot: String?
            public let reason: String?
            public let needsArbiter: Bool?
        }
        public struct Verdict: Decodable, Sendable {
            public let angles: [AngleVerdict]
            public let overall_confidence: Double
        }
        public struct AngleVerdict: Decodable, Sendable {
            public let angle: String
            public let usable: Bool
            public let new_damage: Bool
            public let severity: Int
            public let location: String
            public let description: String
            public let confidence: Double
        }
        public struct Tx: Decodable, Sendable {
            public let label: String
            public let hash: String
            public let url: String
        }
    }

    public struct ScanResult: Decodable, Sendable {
        public let manifestHash: String
        public let txHash: String?
    }

    // MARK: calls

    /// Registers this device's public key; idempotent for the same key.
    public func registerDevice(role: Role, signer: ManifestSigner, label: String) async throws -> String {
        struct Body: Encodable { let role: String; let publicKeySpkiB64: String; let label: String }
        struct Res: Decodable { let deviceKeyId: String }
        let res: Res = try await post("devices", Body(role: role.rawValue, publicKeySpkiB64: signer.publicKeySPKI.base64EncodedString(), label: label))
        return res.deviceKeyId
    }

    public func rental(_ id: String) async throws -> RentalView {
        try await send(URLRequest(url: baseURL.appending(path: "rentals/\(id)")))
    }

    public func health0g() async throws -> (router: Bool, storage: Bool) {
        struct Res: Decodable { let router: Bool; let storage: Bool }
        let r: Res = try await send(URLRequest(url: baseURL.appending(path: "health/0g")))
        return (r.router, r.storage)
    }

    /// Multipart upload: `manifest` (canonical JSON), `signature` (base64 DER), and one JPEG per angle.
    /// `photos[angle]` must be the exact bytes hashed into the manifest.
    public func uploadScan(_ manifest: Manifest, signature: String, photos: [Angle: Data]) async throws -> ScanResult {
        precondition(manifest.isComplete, "manifest needs six shots in angle order")
        let boundary = "evenhand-\(UUID().uuidString)"
        var body = Data()
        func field(_ name: String, _ value: Data, filename: String? = nil, type: String? = nil) {
            body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"".data(using: .utf8)!)
            if let filename { body.append("; filename=\"\(filename)\"".data(using: .utf8)!) }
            body.append("\r\n".data(using: .utf8)!)
            if let type { body.append("Content-Type: \(type)\r\n".data(using: .utf8)!) }
            body.append("\r\n".data(using: .utf8)!)
            body.append(value)
            body.append("\r\n".data(using: .utf8)!)
        }
        field("manifest", manifest.canonicalBytes)
        field("signature", Data(signature.utf8))
        for angle in Angle.allCases {
            guard let jpeg = photos[angle] else { throw APIError(status: 0, message: "missing photo \(angle.rawValue)") }
            field(angle.rawValue, jpeg, filename: "\(angle.rawValue).jpg", type: "image/jpeg")
        }
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        var request = URLRequest(url: baseURL.appending(path: "rentals/\(manifest.rentalId)/scans/\(manifest.phase.rawValue)"))
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        request.timeoutInterval = 120 // the return scan waits for the onchain recordReturn
        return try await send(request)
    }

    // MARK: plumbing

    private func post<B: Encodable, R: Decodable>(_ path: String, _ body: B) async throws -> R {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    private func send<R: Decodable>(_ request: URLRequest) async throws -> R {
        var request = request
        if request.timeoutInterval == 60 { request.timeoutInterval = 30 }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "request failed"
            throw APIError(status: status, message: message)
        }
        return try JSONDecoder().decode(R.self, from: data)
    }
}
