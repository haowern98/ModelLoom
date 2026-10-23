import * as opaque from '@serenity-kit/opaque';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

export interface PairingContext {
  id: string;
  client: string;
  server: string;
  clientName: string;
  serverName: string;
}
function identifiers(c: PairingContext) {
  return {
    client: JSON.stringify(['ModelLoom-code-v1', c.id, 'coordinator', c.client, c.clientName]),
    server: JSON.stringify(['ModelLoom-code-v1', c.id, 'worker', c.server, c.serverName]),
  };
}
function confirmation(key: string, c: PairingContext, attempt: string): string {
  return createHmac('sha256', key)
    .update(JSON.stringify(['ModelLoom-code-confirm-v1', identifiers(c), attempt]))
    .digest('hex');
}
export interface PairingStart {
  attempt: string;
  response: string;
}
export interface PairingProof {
  attempt: string;
  proof: string;
}

/** One receiver-displayed secret. OPAQUE authenticates its identity-bound transcript;
 * neither the PIN nor a PIN-derived verifier is transported to an untrusted peer. */
export class CodePairing {
  private secret = String(randomInt(1000000)).padStart(6, '0');
  private setup = '';
  private record = '';
  private state: { id: string; value: string } | undefined;
  private attempts = 0;
  private ended = false;
  private authenticated = false;
  private readonly expires: number;
  private constructor(
    private readonly context: PairingContext,
    private readonly clock: () => number,
  ) {
    this.expires = clock() + 300000;
  }
  static async create(
    context: PairingContext,
    clock = () => performance.now(),
  ): Promise<CodePairing> {
    await opaque.ready;
    const value = new CodePairing(context, clock);
    value.setup = opaque.server.createSetup();
    const registration = opaque.client.startRegistration({ password: value.secret });
    const response = opaque.server.createRegistrationResponse({
      serverSetup: value.setup,
      userIdentifier: context.id,
      registrationRequest: registration.registrationRequest,
    });
    value.record = opaque.client.finishRegistration({
      clientRegistrationState: registration.clientRegistrationState,
      registrationResponse: response.registrationResponse,
      password: value.secret,
      identifiers: identifiers(context),
    }).registrationRecord;
    return value;
  }
  private active(): void {
    if (this.ended || this.clock() >= this.expires) {
      this.close();
      throw Error('PAIRING_EXPIRED');
    }
  }
  get code(): string {
    this.active();
    return this.secret;
  }
  get verified(): boolean {
    return this.authenticated;
  }
  start(request: string): PairingStart {
    this.active();
    if (this.authenticated || ++this.attempts > 5) throw Error('PAIRING_ATTEMPTS_EXCEEDED');
    this.state = undefined;
    try {
      const result = opaque.server.startLogin({
        serverSetup: this.setup,
        userIdentifier: this.context.id,
        registrationRecord: this.record,
        startLoginRequest: request,
        identifiers: identifiers(this.context),
      });
      const id = randomUUID();
      this.state = { id, value: result.serverLoginState };
      return { attempt: id, response: result.loginResponse };
    } catch {
      throw Error('PAIRING_CODE_INVALID');
    }
  }
  finish(input: PairingProof): string {
    this.active();
    const state = this.state;
    this.state = undefined;
    if (!state || state.id !== input.attempt || this.authenticated)
      throw Error('PAIRING_CODE_INVALID');
    try {
      const { sessionKey } = opaque.server.finishLogin({
        serverLoginState: state.value,
        finishLoginRequest: input.proof,
      });
      this.authenticated = true;
      this.secret = this.setup = this.record = '';
      return confirmation(sessionKey, this.context, input.attempt);
    } catch {
      throw Error('PAIRING_CODE_INVALID');
    }
  }
  close(): void {
    this.ended = true;
    this.secret = this.setup = this.record = '';
    this.state = undefined;
  }
}

/** Client finish authenticates the receiver; its receipt also confirms receiver
 * consumption of this exact attempt before an approved identity may be remembered. */
export async function verifyPairingCode(
  context: PairingContext,
  code: string,
  start: (request: string) => Promise<PairingStart>,
): Promise<PairingProof & { accept(receipt: string): void }> {
  if (!/^\d{6}$/u.test(code)) throw Error('PAIRING_CODE_INVALID');
  await opaque.ready;
  const login = opaque.client.startLogin({ password: code });
  const response = await start(login.startLoginRequest);
  let result;
  try {
    result = opaque.client.finishLogin({
      clientLoginState: login.clientLoginState,
      loginResponse: response.response,
      password: code,
      identifiers: identifiers(context),
    });
  } catch {
    throw Error('PAIRING_CODE_INVALID');
  }
  if (!result) throw Error('PAIRING_CODE_INVALID');
  const expected = Buffer.from(confirmation(result.sessionKey, context, response.attempt), 'hex');
  return {
    attempt: response.attempt,
    proof: result.finishLoginRequest,
    accept(receipt) {
      if (
        !/^[a-f0-9]{64}$/u.test(receipt) ||
        !timingSafeEqual(expected, Buffer.from(receipt, 'hex'))
      )
        throw Error('PAIRING_CODE_INVALID');
    },
  };
}
