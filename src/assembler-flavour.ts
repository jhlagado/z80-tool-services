export const Z80_ASSEMBLER_FLAVOUR = Object.freeze({
  atom: 'atom',
  azm: 'azm',
  auto: 'auto',
} as const);

export type Z80AssemblerFlavour =
  (typeof Z80_ASSEMBLER_FLAVOUR)[keyof typeof Z80_ASSEMBLER_FLAVOUR];

export type ConcreteZ80AssemblerFlavour = Exclude<
  Z80AssemblerFlavour,
  typeof Z80_ASSEMBLER_FLAVOUR.auto
>;

const assemblerFlavourAliases = new Map<string, Z80AssemblerFlavour>([
  ['atom', Z80_ASSEMBLER_FLAVOUR.atom],
  ['atom-z80', Z80_ASSEMBLER_FLAVOUR.atom],
  ['azm', Z80_ASSEMBLER_FLAVOUR.azm],
  ['asm80', Z80_ASSEMBLER_FLAVOUR.azm],
  ['auto', Z80_ASSEMBLER_FLAVOUR.auto],
]);

export const z80AssemblerFlavours = Object.freeze([
  Z80_ASSEMBLER_FLAVOUR.atom,
  Z80_ASSEMBLER_FLAVOUR.azm,
  Z80_ASSEMBLER_FLAVOUR.auto,
] as const);

const concreteZ80AssemblerFlavours = Object.freeze([
  Z80_ASSEMBLER_FLAVOUR.atom,
  Z80_ASSEMBLER_FLAVOUR.azm,
] as const);

export const normalizeZ80AssemblerFlavour = (
  value: unknown,
  {
    defaultFlavour = Z80_ASSEMBLER_FLAVOUR.auto,
    allowAuto = true,
  }: {
    readonly defaultFlavour?: Z80AssemblerFlavour;
    readonly allowAuto?: boolean;
  } = {},
): Z80AssemblerFlavour => {
  if (!z80AssemblerFlavours.includes(defaultFlavour)) {
    throw new TypeError('default assembler flavour is invalid');
  }
  const flavour =
    value === undefined || value === null
      ? defaultFlavour
      : typeof value === 'string'
        ? assemblerFlavourAliases.get(value.trim().toLowerCase())
        : undefined;
  if (flavour === undefined) {
    throw new TypeError('assembler flavour must be atom, azm, or auto');
  }
  if (!allowAuto && flavour === Z80_ASSEMBLER_FLAVOUR.auto) {
    throw new TypeError('assembler flavour must be atom or azm');
  }
  return flavour;
};

export interface SelectConcreteZ80AssemblerFlavourOptions {
  readonly requested?: unknown;
  readonly defaultFlavour?: ConcreteZ80AssemblerFlavour;
  readonly sourcePath?: string;
}

export type Z80AssemblerFlavourHandlers<Result> = Readonly<
  Record<
    ConcreteZ80AssemblerFlavour,
    (flavour: ConcreteZ80AssemblerFlavour) => Result
  >
>;

export interface DispatchZ80AssemblerFlavourOptions<
  Result,
> extends SelectConcreteZ80AssemblerFlavourOptions {
  readonly handlers: Z80AssemblerFlavourHandlers<Result>;
}

/**
 * Select the concrete assembler that will own one assembly source.
 *
 * `.asm` is shared by Atom and AZM. This helper deliberately does not infer a
 * format from the filename. A command-specific caller may provide a concrete
 * default, such as the `atom` executable defaulting to Atom. A neutral caller,
 * such as a Debug80 project loader, should omit the default and require the
 * project or target to name the assembler explicitly.
 */
export const selectConcreteZ80AssemblerFlavour = ({
  requested,
  defaultFlavour,
  sourcePath = 'source',
}: SelectConcreteZ80AssemblerFlavourOptions = {}): ConcreteZ80AssemblerFlavour => {
  const hasDefault = defaultFlavour !== undefined;
  if (hasDefault && !concreteZ80AssemblerFlavours.includes(defaultFlavour)) {
    throw new TypeError('default assembler flavour is invalid');
  }
  const flavour = normalizeZ80AssemblerFlavour(requested, {
    defaultFlavour: defaultFlavour ?? Z80_ASSEMBLER_FLAVOUR.auto,
    allowAuto: true,
  });
  if (flavour === Z80_ASSEMBLER_FLAVOUR.auto) {
    throw new TypeError(
      `${sourcePath} does not select an assembler from its filename; set assembler to atom or azm`,
    );
  }
  return flavour;
};

/**
 * Dispatch a shared `.asm` source to the assembler implementation selected by
 * caller policy. The shared package owns only the flavour decision; concrete
 * Atom and AZM assembly remains in language-specific packages.
 */
export const dispatchZ80AssemblerFlavour = <Result>({
  requested,
  defaultFlavour,
  sourcePath,
  handlers,
}: DispatchZ80AssemblerFlavourOptions<Result>): Result => {
  const flavour = selectConcreteZ80AssemblerFlavour({
    requested,
    ...(defaultFlavour === undefined ? {} : { defaultFlavour }),
    ...(sourcePath === undefined ? {} : { sourcePath }),
  });
  const handler = handlers[flavour];
  if (typeof handler !== 'function') {
    throw new TypeError(`assembler handler for ${flavour} is unavailable`);
  }
  return handler(flavour);
};
