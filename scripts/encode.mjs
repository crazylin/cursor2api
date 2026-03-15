#!/usr/bin/env node
/**
 * Encode plaintext → XOR hex string for use with _x() in obfuscate.ts
 * Usage: node scripts/encode.mjs "plaintext string"
 */
const _K = [0x5A, 0x3F, 0x17, 0x6B, 0x2E, 0x41, 0x58, 0x0D, 0x73, 0x1C, 0x44, 0x29, 0x66, 0x35, 0x7A, 0x02];

const text = process.argv[2];
if (!text) {
    console.error('Usage: node scripts/encode.mjs "text to encode"');
    process.exit(1);
}

const hex = [...text].map((c, i) => (c.charCodeAt(0) ^ _K[i % _K.length]).toString(16).padStart(2, '0')).join('');
console.log(`_x('${hex}')`);

// Verify decode
const decoded = [];
for (let i = 0; i < hex.length; i += 2) {
    decoded.push(String.fromCharCode(parseInt(hex.substring(i, i + 2), 16) ^ _K[i / 2 % _K.length]));
}
console.log(`// Decodes to: ${decoded.join('')}`);
