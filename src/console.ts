/** Language-neutral byte console and terminal service primitives. */

import {
  DEFAULT_ONE_BYTE_STATUS_POLICY,
  invokeOneByteStatus,
  oneByteValue,
  type GenerationLifecycleConformanceResult,
  type OneByteGatewayResult,
  type OneByteStatusPolicy,
} from './generation.js';

export interface ByteConsoleService {
  read?(): unknown;
  write?(value: number): unknown;
  exitSuccess?(): unknown;
  exitFailure?(status: number): unknown;
}

export interface ConsoleServiceGateway {
  consoleRead(): OneByteGatewayResult | undefined;
  consoleWrite(
    request?: Readonly<Record<string, unknown>>,
  ): OneByteGatewayResult | undefined;
  exitSuccess(): OneByteGatewayResult | undefined;
  exitFailure(
    request?: Readonly<Record<string, unknown>>,
  ): OneByteGatewayResult | undefined;
}

export interface ConsoleServiceGatewayConformanceFixtures {
  readonly console: ByteConsoleService;
  readonly effects: string[];
}

export interface ConsoleServiceGatewayConformanceFactory {
  create(
    fixtures: ConsoleServiceGatewayConformanceFixtures,
  ): ConsoleServiceGateway;
}

export interface ConsoleServiceGatewayConformanceOptions {
  readonly policy?: OneByteStatusPolicy;
}

const fail = (vector: string, message: string): never => {
  throw new Error(`console service gateway conformance ${vector}: ${message}`);
};

export const dispatchConsoleRead = (
  service: ByteConsoleService | undefined,
  policy: OneByteStatusPolicy = DEFAULT_ONE_BYTE_STATUS_POLICY,
): OneByteGatewayResult => {
  if (typeof service?.read !== 'function') {
    return { status: policy.unavailable };
  }
  try {
    const value = oneByteValue(service.read());
    return value === undefined
      ? { status: policy.invalid }
      : { status: policy.success, value };
  } catch {
    return { status: policy.exception };
  }
};

export const dispatchConsoleWrite = (
  service: ByteConsoleService | undefined,
  request: Readonly<Record<string, unknown>> | undefined,
  policy: OneByteStatusPolicy = DEFAULT_ONE_BYTE_STATUS_POLICY,
): OneByteGatewayResult => {
  const value = oneByteValue(request?.value);
  if (value === undefined) return { status: policy.invalid };
  if (typeof service?.write !== 'function')
    return { status: policy.unavailable };
  return {
    status: invokeOneByteStatus(() => service.write?.(value), policy).status,
  };
};

export const dispatchConsoleExitSuccess = (
  service: ByteConsoleService | undefined,
  policy: OneByteStatusPolicy = DEFAULT_ONE_BYTE_STATUS_POLICY,
): OneByteGatewayResult => {
  if (typeof service?.exitSuccess !== 'function') {
    return { status: policy.unavailable };
  }
  return {
    status: invokeOneByteStatus(() => service.exitSuccess?.(), policy).status,
  };
};

export const dispatchConsoleExitFailure = (
  service: ByteConsoleService | undefined,
  request: Readonly<Record<string, unknown>> | undefined,
  policy: OneByteStatusPolicy = DEFAULT_ONE_BYTE_STATUS_POLICY,
): OneByteGatewayResult => {
  const status = oneByteValue(request?.status);
  if (status === undefined || status === policy.success) {
    return { status: policy.invalid };
  }
  if (typeof service?.exitFailure !== 'function') {
    return { status: policy.unavailable };
  }
  return {
    status: invokeOneByteStatus(() => service.exitFailure?.(status), policy)
      .status,
  };
};

export const runConsoleServiceGatewayConformance = (
  factory: ConsoleServiceGatewayConformanceFactory,
  options: ConsoleServiceGatewayConformanceOptions = {},
): GenerationLifecycleConformanceResult => {
  const policy = options.policy ?? DEFAULT_ONE_BYTE_STATUS_POLICY;
  let assertions = 0;

  const expectResult = (
    vector: string,
    actual: OneByteGatewayResult | undefined,
    expected: OneByteGatewayResult,
  ): void => {
    assertions += 1;
    if (actual?.status !== expected.status || actual.value !== expected.value) {
      fail(
        vector,
        `result ${JSON.stringify(actual)} does not equal ${JSON.stringify(
          expected,
        )}`,
      );
    }
  };

  const expectEffects = (
    vector: string,
    actual: readonly string[],
    expected: readonly string[],
  ): void => {
    assertions += 1;
    if (
      actual.length !== expected.length ||
      expected.some((effect, index) => actual[index] !== effect)
    ) {
      fail(vector, `effects [${actual}] do not equal [${expected}]`);
    }
  };

  {
    const vector = 'console-success';
    const effects: string[] = [];
    const gateway = factory.create({
      effects,
      console: {
        read: () => 0x7f,
        write(value) {
          effects.push(`write:${value}`);
        },
        exitSuccess() {
          effects.push('success');
        },
        exitFailure(status) {
          effects.push(`failure:${status}`);
        },
      },
    });
    expectResult(vector, gateway.consoleRead(), {
      status: policy.success,
      value: 0x7f,
    });
    expectResult(vector, gateway.consoleWrite({ value: 0x80 }), {
      status: policy.success,
    });
    expectResult(vector, gateway.exitSuccess(), { status: policy.success });
    expectResult(vector, gateway.exitFailure({ status: 0x55 }), {
      status: policy.success,
    });
    expectEffects(vector, effects, ['write:128', 'success', 'failure:85']);
  }

  {
    const vector = 'console-unavailable-and-request-validation';
    const effects: string[] = [];
    const gateway = factory.create({ effects, console: {} });
    expectResult(vector, gateway.consoleRead(), { status: policy.unavailable });
    expectResult(vector, gateway.consoleWrite({ value: 0x100 }), {
      status: policy.invalid,
    });
    expectResult(vector, gateway.consoleWrite({ value: 0x20 }), {
      status: policy.unavailable,
    });
    expectResult(vector, gateway.exitSuccess(), { status: policy.unavailable });
    expectResult(vector, gateway.exitFailure({ status: 0 }), {
      status: policy.invalid,
    });
    expectResult(vector, gateway.exitFailure({ status: 0x20 }), {
      status: policy.unavailable,
    });
    expectEffects(vector, effects, []);
  }

  {
    const vector = 'console-malformed-results';
    const effects: string[] = [];
    const gateway = factory.create({
      effects,
      console: {
        read: () => 0x100,
        write: () => 0x100,
        exitSuccess: () => 0x100,
        exitFailure: () => 0x100,
      },
    });
    expectResult(vector, gateway.consoleRead(), { status: policy.invalid });
    expectResult(vector, gateway.consoleWrite({ value: 0x20 }), {
      status: policy.invalid,
    });
    expectResult(vector, gateway.exitSuccess(), { status: policy.invalid });
    expectResult(vector, gateway.exitFailure({ status: 0x20 }), {
      status: policy.invalid,
    });
    expectEffects(vector, effects, []);
  }

  {
    const vector = 'console-host-exceptions';
    const effects: string[] = [];
    const throwFailure = (): never => {
      throw new Error('injected console failure');
    };
    const gateway = factory.create({
      effects,
      console: {
        read: throwFailure,
        write: throwFailure,
        exitSuccess: throwFailure,
        exitFailure: throwFailure,
      },
    });
    expectResult(vector, gateway.consoleRead(), { status: policy.exception });
    expectResult(vector, gateway.consoleWrite({ value: 0x20 }), {
      status: policy.exception,
    });
    expectResult(vector, gateway.exitSuccess(), { status: policy.exception });
    expectResult(vector, gateway.exitFailure({ status: 0x20 }), {
      status: policy.exception,
    });
  }

  return { vectors: 4, assertions };
};
