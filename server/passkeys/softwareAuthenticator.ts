import { webcrypto } from 'node:crypto';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { COSEALG, cose, isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';
import { webAuthnBytes } from './bytes';

// Test-only software authenticator. The API does not import this module.
// It produces real ES256 signatures so the server verifier can be exercised
// without a fingerprint sensor. A caller can clear the UV flag; a platform
// authenticator would not sign that flag unless the person unlocked the device.
export class SoftwareAuthenticator {
  private counter = 0;
  private readonly privateKey: webcrypto.CryptoKey;
  private readonly cosePublicKey: Uint8Array<ArrayBuffer>;
  readonly credentialId: Uint8Array<ArrayBuffer>;
  readonly userHandle: Uint8Array<ArrayBuffer>;

  private constructor(
    privateKey: webcrypto.CryptoKey,
    cosePublicKey: Uint8Array<ArrayBuffer>,
    credentialId: Uint8Array<ArrayBuffer>,
    userHandle: Uint8Array<ArrayBuffer>,
  ) {
    this.privateKey = privateKey;
    this.cosePublicKey = cosePublicKey;
    this.credentialId = credentialId;
    this.userHandle = userHandle;
  }

  static async create(userId: string): Promise<SoftwareAuthenticator> {
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    if (!jwk.x || !jwk.y) throw new Error('missing public key coordinates');
    const coseKey = new Map<number, number | Uint8Array>([
      [cose.COSEKEYS.kty, cose.COSEKTY.EC2],
      [cose.COSEKEYS.alg, COSEALG.ES256],
      [cose.COSEKEYS.crv, cose.COSECRV.P256],
      [cose.COSEKEYS.x, isoBase64URL.toBuffer(jwk.x)],
      [cose.COSEKEYS.y, isoBase64URL.toBuffer(jwk.y)],
    ]);
    return new SoftwareAuthenticator(
      keyPair.privateKey,
      webAuthnBytes(isoCBOR.encode(coseKey)),
      webAuthnBytes(crypto.getRandomValues(new Uint8Array(16))),
      webAuthnBytes(isoBase64URL.toBuffer(isoBase64URL.fromUTF8String(userId))),
    );
  }

  get credentialIdText(): string {
    return isoBase64URL.fromBuffer(this.credentialId);
  }

  async exportPrivateKey(): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.exportKey('pkcs8', this.privateKey));
  }

  async registrationResponse(input: {
    challenge: string;
    origin: string;
    rpId: string;
    userVerified: boolean;
  }): Promise<RegistrationResponseJSON> {
    const clientData = clientDataBytes('webauthn.create', input.challenge, input.origin);
    const authData = await authenticatorData({
      rpId: input.rpId,
      flags: input.userVerified ? 0x45 : 0x41,
      counter: 0,
      credentialId: this.credentialId,
      publicKey: this.cosePublicKey,
    });
    const attestationObject = new Map<string, string | Uint8Array<ArrayBuffer> | Map<string, never>>();
    attestationObject.set('fmt', 'none');
    attestationObject.set('attStmt', new Map<string, never>());
    attestationObject.set('authData', webAuthnBytes(authData));
    const attestation = isoCBOR.encode(attestationObject);
    const id = this.credentialIdText;
    return {
      id,
      rawId: id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(webAuthnBytes(clientData)),
        attestationObject: isoBase64URL.fromBuffer(webAuthnBytes(attestation)),
        transports: ['internal'],
      },
    };
  }

  async authenticationResponse(input: {
    challenge: string;
    origin: string;
    rpId: string;
    userVerified: boolean;
    counter?: number;
    userHandle?: Uint8Array | null;
  }): Promise<AuthenticationResponseJSON> {
    const counter = input.counter ?? (this.counter += 1);
    const clientData = clientDataBytes('webauthn.get', input.challenge, input.origin);
    const authData = await authenticatorData({
      rpId: input.rpId,
      flags: input.userVerified ? 0x05 : 0x01,
      counter,
    });
    const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientData));
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        this.privateKey,
        concat([authData, clientDataHash]),
      ),
    );
    const handle = input.userHandle === null ? undefined : (input.userHandle ?? this.userHandle);
    const id = this.credentialIdText;
    return {
      id,
      rawId: id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(webAuthnBytes(clientData)),
        authenticatorData: isoBase64URL.fromBuffer(webAuthnBytes(authData)),
        signature: isoBase64URL.fromBuffer(webAuthnBytes(derSignature(raw))),
        userHandle: handle ? isoBase64URL.fromBuffer(webAuthnBytes(handle)) : undefined,
      },
    };
  }
}

function clientDataBytes(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

async function authenticatorData(input: {
  rpId: string;
  flags: number;
  counter: number;
  credentialId?: Uint8Array;
  publicKey?: Uint8Array;
}): Promise<Uint8Array> {
  const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.rpId)));
  const counter = new Uint8Array(4);
  new DataView(counter.buffer).setUint32(0, input.counter, false);
  const parts = [rpIdHash, Uint8Array.of(input.flags), counter];
  if (input.credentialId && input.publicKey) {
    const idLength = new Uint8Array(2);
    new DataView(idLength.buffer).setUint16(0, input.credentialId.length, false);
    parts.push(new Uint8Array(16), idLength, webAuthnBytes(input.credentialId), webAuthnBytes(input.publicKey));
  }
  return concat(parts);
}

function derSignature(raw: Uint8Array): Uint8Array {
  if (raw.length !== 64) throw new Error(`unexpected raw signature length ${raw.length}`);
  const body = concat([derInteger(raw.subarray(0, 32)), derInteger(raw.subarray(32))]);
  return concat([Uint8Array.of(0x30, body.length), body]);
}

function derInteger(bytes: Uint8Array): Uint8Array {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0 && ((bytes[start + 1] ?? 0) & 0x80) === 0) start += 1;
  const rest = bytes.subarray(start);
  const content = ((rest[0] ?? 0) & 0x80) !== 0 ? concat([Uint8Array.of(0), rest]) : rest;
  return concat([Uint8Array.of(0x02, content.length), content]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
