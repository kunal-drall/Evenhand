import CryptoKit
import Foundation
import Security

/// Signs canonical manifest bytes with P-256 / SHA-256; the server verifies DER signatures against the SPKI key.
public protocol ManifestSigner: Sendable {
    /// SPKI DER public key, base64 in POST /devices.
    var publicKeySPKI: Data { get }
    /// DER-encoded ECDSA signature over `data` (SHA-256 is applied by CryptoKit).
    func sign(_ data: Data) throws -> Data
}

extension ManifestSigner {
    public func signatureBase64(for manifest: Manifest) throws -> String {
        try sign(manifest.canonicalBytes).base64EncodedString()
    }
}

/// The phone's key. Created once inside the Secure Enclave; only an opaque, device-bound handle is stored
/// (in the Keychain). Works only on a real device.
public struct SecureEnclaveSigner: ManifestSigner {
    private let key: SecureEnclave.P256.Signing.PrivateKey

    public static var isAvailable: Bool { SecureEnclave.isAvailable }

    /// Loads the key stored under `tag`, creating it on first use.
    public init(tag: String = "app.evenhand.manifest-key") throws {
        if let blob = Keychain.read(tag) {
            key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob)
        } else {
            key = try SecureEnclave.P256.Signing.PrivateKey()
            try Keychain.write(tag, key.dataRepresentation)
        }
    }

    public var publicKeySPKI: Data { key.publicKey.derRepresentation }

    public func sign(_ data: Data) throws -> Data {
        try key.signature(for: data).derRepresentation
    }
}

/// Software P-256 key, for tests and the simulator. Never use it for real scans.
public struct SoftwareSigner: ManifestSigner {
    public let key: P256.Signing.PrivateKey

    public init(key: P256.Signing.PrivateKey = .init()) { self.key = key }

    public var publicKeySPKI: Data { key.publicKey.derRepresentation }

    public func sign(_ data: Data) throws -> Data {
        try key.signature(for: data).derRepresentation
    }
}

enum Keychain {
    static func read(_ account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        var item: CFTypeRef?
        return SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess ? item as? Data : nil
    }

    static func write(_ account: String, _ data: Data) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data,
        ]
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }
}
