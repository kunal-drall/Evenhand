// Cross-checks Swift signing against the server: canonicalizes a manifest JSON file, signs it with a fresh
// software P-256 key and prints {spki, signature, canonical} (base64) for Node's crypto.verify.
//   swift run fixture-sign ../../packages/shared/fixtures/manifest.json
import EvenhandCore
import Foundation

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: fixture-sign <manifest.json>\n".utf8))
    exit(2)
}
let value = try JSONValue(parsing: Data(contentsOf: URL(filePath: CommandLine.arguments[1])))
let signer = SoftwareSigner()
let signature = try signer.sign(value.canonicalData)
let out = JSONValue.object([
    "spki": .string(signer.publicKeySPKI.base64EncodedString()),
    "signature": .string(signature.base64EncodedString()),
    "canonical": .string(value.canonicalData.base64EncodedString()),
])
print(out.canonicalString)
