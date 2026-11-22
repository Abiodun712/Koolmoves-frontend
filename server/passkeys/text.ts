export function stripControls(input: string): string {
  let cleaned = '';
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 31 || code === 127) continue;
    cleaned += char;
  }
  return cleaned;
}

export function cleanText(input: string, max: number): string {
  return stripControls(input).trim().slice(0, max);
}

export function deviceLabelFrom(input: unknown): string {
  if (typeof input !== 'string') return 'This device';
  const cleaned = cleanText(input, 80);
  return cleaned.length > 0 ? cleaned : 'This device';
}

export function displayNameFrom(name: string, email: string): string {
  const cleaned = cleanText(name, 80);
  return cleaned.length > 0 ? cleaned : email;
}
