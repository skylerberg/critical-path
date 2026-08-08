// Three rules rather than one, because "control character" means a different
// set at each boundary. Every rule exists because Postgres refuses a NUL inside
// a text bind parameter, so a control character that survives validation turns a
// bad request into a 500.
//
// - Multi-line freeform text keeps tab, newline and carriage return and rejects
//   the rest of C0.
// - A single-line value such as a URL keeps none of them and drops DEL too,
//   which is the whole ASCII control set.
// - Text bound for an HTTP header or a filename drops C1 as well — Unicode
//   category Cc — because those bytes reach a header value as raw control bytes
//   and Node throws on an illegal one rather than sending it.

export function hasControlCharacterBesidesWhitespace(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true;
  }
  return false;
}

export function hasAsciiControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function isUnicodeControlCode(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}
