export function webAuthnBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
  copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return copy;
}
