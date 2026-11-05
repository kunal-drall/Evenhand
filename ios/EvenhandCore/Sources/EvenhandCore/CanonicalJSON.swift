import Foundation

/// JSON value with RFC 8785 (JCS) serialization, matching the server's `canonicalize` package for the
/// values a manifest uses: objects, arrays, strings, integers, booleans and null. Integers only, as the spec says.
public indirect enum JSONValue: Equatable, Sendable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case int(Int)
    case bool(Bool)
    case null

    /// Canonical UTF-8 bytes: keys sorted by UTF-16 code units, no whitespace, minimal string escaping.
    public var canonicalData: Data { Data(canonicalString.utf8) }

    public var canonicalString: String {
        var out = ""
        write(into: &out)
        return out
    }

    private func write(into out: inout String) {
        switch self {
        case .null: out += "null"
        case .bool(let b): out += b ? "true" : "false"
        case .int(let i): out += String(i)
        case .string(let s): JSONValue.writeString(s, into: &out)
        case .array(let items):
            out += "["
            for (i, item) in items.enumerated() {
                if i > 0 { out += "," }
                item.write(into: &out)
            }
            out += "]"
        case .object(let members):
            out += "{"
            let keys = members.keys.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) }
            for (i, key) in keys.enumerated() {
                if i > 0 { out += "," }
                JSONValue.writeString(key, into: &out)
                out += ":"
                members[key]!.write(into: &out)
            }
            out += "}"
        }
    }

    /// RFC 8785 / ECMAScript JSON.stringify escaping: only quote, backslash and control characters.
    /// Notably "/" and non-ASCII are written as-is (JSONEncoder escapes "/" unless told not to).
    private static func writeString(_ s: String, into out: inout String) {
        out += "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{09}": out += "\\t"
            case "\u{0A}": out += "\\n"
            case "\u{0C}": out += "\\f"
            case "\u{0D}": out += "\\r"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
    }
}

extension JSONValue {
    /// Parses JSON (via JSONSerialization) into a JSONValue. Non-integer numbers are rejected.
    public init(parsing data: Data) throws {
        self = try JSONValue.from(JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]))
    }

    private static func from(_ any: Any) throws -> JSONValue {
        switch any {
        case let d as [String: Any]: return .object(try d.mapValues(from))
        case let a as [Any]: return .array(try a.map(from))
        case let s as String: return .string(s)
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return .bool(n.boolValue) }
            guard n.doubleValue == n.doubleValue.rounded(), abs(n.doubleValue) < 9_007_199_254_740_992 else {
                throw CanonicalJSONError.nonIntegerNumber
            }
            return .int(n.intValue)
        case is NSNull: return .null
        default: throw CanonicalJSONError.unsupported
        }
    }
}

public enum CanonicalJSONError: Error {
    case nonIntegerNumber
    case unsupported
}
