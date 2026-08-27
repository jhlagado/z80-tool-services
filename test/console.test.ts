import { describe, expect, it } from 'vitest';

import {
  dispatchConsoleExitFailure,
  dispatchConsoleExitSuccess,
  dispatchConsoleRead,
  dispatchConsoleWrite,
  runConsoleServiceGatewayConformance,
  type ByteConsoleService,
} from '../src/index.js';

describe('console service primitives', () => {
  it('dispatches byte input and output requests', () => {
    const output: number[] = [];
    const service = {
      read: () => 0x41,
      write(value: number) {
        output.push(value);
      },
    };

    expect(dispatchConsoleRead(service)).toEqual({ status: 0, value: 0x41 });
    expect(dispatchConsoleWrite(service, { value: 0xff })).toEqual({
      status: 0,
    });
    expect(output).toEqual([0xff]);
  });

  it('dispatches terminal success and failure requests', () => {
    const exits: number[] = [];
    const service = {
      exitSuccess() {
        exits.push(0);
      },
      exitFailure(status: number) {
        exits.push(status);
      },
    };

    expect(dispatchConsoleExitSuccess(service)).toEqual({ status: 0 });
    expect(dispatchConsoleExitFailure(service, { status: 0x55 })).toEqual({
      status: 0,
    });
    expect(exits).toEqual([0, 0x55]);
  });

  it('rejects malformed requests without calling the host service', () => {
    const output: number[] = [];
    const service = {
      write(value: number) {
        output.push(value);
      },
      exitFailure(status: number) {
        output.push(status);
      },
    };

    expect(dispatchConsoleWrite(service, { value: 0x100 })).toEqual({
      status: 0xfe,
    });
    expect(dispatchConsoleExitFailure(service, { status: 0 })).toEqual({
      status: 0xfe,
    });
    expect(output).toEqual([]);
  });

  it('reports unavailable, malformed results, and thrown services', () => {
    expect(dispatchConsoleRead(undefined)).toEqual({ status: 0x02 });
    expect(dispatchConsoleRead({ read: () => -1 })).toEqual({ status: 0xfe });
    expect(
      dispatchConsoleWrite(
        {
          write() {
            throw new Error('failed');
          },
        },
        { value: 0 },
      ),
    ).toEqual({ status: 0xef });
    expect(dispatchConsoleExitSuccess({ exitSuccess: () => 0x100 })).toEqual({
      status: 0xfe,
    });
  });

  it('passes reusable console-service gateway conformance vectors', () => {
    expect(
      runConsoleServiceGatewayConformance({
        create: (fixtures) => ({
          consoleRead: () => dispatchConsoleRead(fixtures.console),
          consoleWrite: (request) =>
            dispatchConsoleWrite(fixtures.console, request),
          exitSuccess: () => dispatchConsoleExitSuccess(fixtures.console),
          exitFailure: (request) =>
            dispatchConsoleExitFailure(fixtures.console, request),
        }),
      }),
    ).toEqual({ vectors: 4, assertions: 21 });
  });

  it('allows Atom-style exception policy mapping', () => {
    const policy = Object.freeze({
      success: 0,
      unavailable: 2,
      invalid: 0xfe,
      exception: 0xfe,
    });
    const service: ByteConsoleService = {
      read() {
        throw new Error('failed');
      },
    };

    expect(dispatchConsoleRead(service, policy)).toEqual({ status: 0xfe });
  });
});
