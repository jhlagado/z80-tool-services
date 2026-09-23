# Legacy NOBJ conversion fixtures

These streams were emitted by the ATOM 0.2 and Nucleus 0.1 writer paths and
accepted by their corresponding legacy readers before the bytes were captured.
The host tests run the shared legacy readers, convert each object to NOBJ 1.0,
then compare materialized bytes and retained layout fields.

| Fixture | Producer profile | Coverage |
| --- | --- | --- |
| `atom-0.2-empty.nobj.hex` | ATOM 0.2 | No IMAGE records, zero used extent, selected entry and cursor at the image base |
| `atom-0.2-sparse-patched-cursor.nobj.hex` | ATOM 0.2 | Sparse IMAGE data, an image-backed PATCH, two source parts, and a cursor below the high-water mark |
| `atom-0.2-cursor-65536.nobj.hex` | ATOM 0.2 | Filled DS extent and final cursor at the exclusive 65536 endpoint |
| `atom-0.2-ds-fill.nobj.hex` | ATOM 0.2 | DS-only fill with no IMAGE records and a cursor above the used extent |
| `nucleus-0.1-banked-rom.nobj.hex` | Nucleus 0.1 | Two ROM banks, ROM-to-RAM initialization, BSS, established stack, sparse fill, source-part order, read-only and aggregate ranges, and PATCH |
| `nucleus-0.1-singlebank-rom.nobj.hex` | Nucleus 0.1 | One unbanked ROM image, empty BSS, and no established stack |
| `nucleus-0.1-loaded.nobj.hex` | Nucleus 0.1 | Loaded image with writable alias, same-physical RUN/LOAD initialization, BSS, and repeated source parts |
| `nucleus-0.1-provider-layout.nobj.hex` | Nucleus 0.1 | Noncanonical runtime identity requiring an explicit provider state length |

The fixture contents are test data, not instructions. The executable
specification remains the producer formats and the NOBJ 1.0 contract.
