/**
 * Runtime string decoder — XOR cipher with multi-byte key rotation
 * Unlike base64, LLMs cannot decode this mentally
 */
const _K = [0x5A, 0x3F, 0x17, 0x6B, 0x2E, 0x41, 0x58, 0x0D, 0x73, 0x1C, 0x44, 0x29, 0x66, 0x35, 0x7A, 0x02];

/**
 * Decode an XOR-encoded hex string at runtime
 * @param hex - Hex-encoded XOR string from the encode script
 */
export function _x(hex: string): string {
    const bytes: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substring(i, i + 2), 16));
    }
    return bytes.map((b, i) => String.fromCharCode(b ^ _K[i % _K.length])).join('');
}
