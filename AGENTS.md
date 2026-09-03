# Z80 Tool Services repository instructions

This repository owns the language-neutral host and native service contracts
shared by Z80 development tools. Keep Atom-, Nucleus-, editor-, and
machine-specific policy in their owning repositories.

Changes to a public TypeScript contract must remain aligned with its native
Z80 ABI and conformance vectors. Run `npm run check` before handoff. A green
host-model proof is not evidence of timing or memory behaviour on physical
hardware.

The package was extracted with path history from Debug80. Debug80 may consume
released versions, but this repository must build and test without a Debug80
checkout.
