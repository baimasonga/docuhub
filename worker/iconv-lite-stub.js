// Workers-safe stand-in for `iconv-lite`.
//
// `body-parser` -> `raw-body` -> `iconv-lite` only to decode the request body
// according to the Content-Type charset. The full iconv-lite package uses a
// pattern (`require('streams')`) that breaks under Cloudflare Workers'
// nodejs_compat shim. Every modern client sends UTF-8 JSON, so we only need
// to support the handful of encodings TextDecoder already knows.

function normalize(encoding) {
  return String(encoding || 'utf-8').toLowerCase().replace(/_/g, '-');
}

const SUPPORTED = new Set([
  'utf-8', 'utf8',
  'utf-16le', 'utf-16be', 'utf16le', 'utf16be',
  'ascii', 'latin1', 'iso-8859-1', 'windows-1252',
]);

export function encodingExists(encoding) {
  return SUPPORTED.has(normalize(encoding));
}

export function decode(buf, encoding) {
  const normalized = normalize(encoding);
  const decoderEncoding = normalized === 'utf8' ? 'utf-8'
    : normalized === 'utf16le' ? 'utf-16le'
    : normalized === 'utf16be' ? 'utf-16be'
    : normalized;
  return new TextDecoder(decoderEncoding).decode(buf);
}

export function encode(str, encoding) {
  // body-parser doesn't call encode, but keep parity with the iconv-lite API.
  const normalized = normalize(encoding);
  if (normalized === 'utf-8' || normalized === 'utf8') {
    return new TextEncoder().encode(String(str));
  }
  throw new Error(`iconv-lite stub: encode() not implemented for "${encoding}"`);
}

export default { encodingExists, decode, encode };
