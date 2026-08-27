# Project-preparation boundary

This directory contains shared language-neutral tool services for source
identity, dependency resolution, placement, and provenance.
The modules may import Node built-ins and other files in this directory. They
must not import Atom- or Nucleus-specific syntax or resident compiler code.

The public neutral surface is `index.mjs`. It provides the confined Node source
reader, deterministic resolver, path-keyed placement join, and immutable
provenance records. Language behavior enters through a profile object. Atom's
`%` grammar and masking implementation remain in Atom's host profile.

The package subpath is `@jhlagado/z80-tool-services/source-preparation`.
Language profiles supply dependency recognition and compiler-byte policy; the
shared layer owns identities, confined reads, graph order, placement,
capacities, and provenance.

The complete contract, operational limits, and proof map are documented in
Atom's [`host-source-preparation.md`](../../atom/docs/host-source-preparation.md).
