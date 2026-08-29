export const Z80_ASSEMBLER_FLAVOUR = Object.freeze({
  atom: 'atom',
  azm: 'azm',
  auto: 'auto',
} as const);

export type Z80AssemblerFlavour =
  (typeof Z80_ASSEMBLER_FLAVOUR)[keyof typeof Z80_ASSEMBLER_FLAVOUR];

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
