; Shared native NOBJ envelope validator and materializer.
;
; The including program supplies three routines:
;
;   ZN_READ   Read the next stored-object byte. Return it in A with carry clear.
;             At end of input return A=ZN_EOF with carry set. ZN_EOF is
;             reserved exclusively for EOF; other carry-set values are input
;             failures. IX and IY must be preserved.
;   ZN_REW    Rewind the stored object. Return A=0 and carry clear on success.
;             IX and IY must be preserved.
;   ZN_PROF   Validate the selected BEGIN, IMAGE/PATCH and MAP profile after
;             the common envelope has passed. IX addresses the state block.
;             It may rewind and read the object. Carry reports failure. IX and
;             IY must be preserved.
;   ZN_INIT   Initialize the validated target's used extents with its fill byte.
;             IX addresses the profile state. Carry reports a target failure.
;             IX and IY must be preserved.
;   ZN_STORE  Store one final byte. A is the byte, B the bank and DE the target
;             address. IX and IY must be preserved. The sink must be infallible
;             for a profile-validated target, or write into tentative storage.
;
; ZN_MAT validates the complete envelope, invokes ZN_PROF, initializes the
; target, rewinds, and only then applies IMAGE and PATCH bytes. It performs no
; symbol resolution: PATCH payloads already contain final bytes.
; The stored object must remain readable and byte-for-byte unchanged, and must
; not alias any target write, until ZN_MAT returns.
;
; IX points at a caller-owned ZN_SIZE-byte state block. The caller initializes
; ZN_MAJOR, ZN_MINOR and ZN_FLAGS. Bit 0 of ZN_FLAGS requires an IMAGE record.

ZN_MAJOR EQU 0
ZN_MINOR EQU 1
ZN_FLAGS EQU 2
ZN_CRCLO EQU 3
ZN_CRCHI EQU 4
ZN_CNTLO EQU 5
ZN_CNTHI EQU 6
ZN_PHASE EQU 7
ZN_SEEN EQU 8
ZN_KIND EQU 9
ZN_LENLO EQU 10
ZN_LENHI EQU 11
ZN_BANK EQU 12
ZN_ADDRLO EQU 13
ZN_ADDRHI EQU 14
ZN_REMLO EQU 15
ZN_REMHI EQU 16
ZN_ENTBNK EQU 17
ZN_ENTLO EQU 18
ZN_ENTHI EQU 19
ZN_SIZE EQU 20

ZN_OK EQU 0
ZN_IO EQU 1
ZN_FRAME EQU 2
ZN_VER EQU 3
ZN_ORDER EQU 4
ZN_COUNT EQU 5
ZN_CRC EQU 6
ZN_PROFILE EQU 7
ZN_STOREE EQU 8
ZN_EOF EQU 1

ZN_BEGIN EQU 1
ZN_IMAGE EQU 2
ZN_PATCH EQU 3
ZN_MAP EQU 4
ZN_COMMIT EQU 5

; Validate common NOBJ framing, phase order, record count and CRC.
;@ROUTINE IN IX OUT A,CARRY CLOBBERS BC,DE,HL,ZERO,SIGN,PARITY,HALFCARRY
ZN_VALID:
CALL ZN_REW
JP   C,ZN_FIO
LD   (IX+ZN_CRCLO),$FF
LD   (IX+ZN_CRCHI),$FF
XOR  A
LD   (IX+ZN_CNTLO),A
LD   (IX+ZN_CNTHI),A
LD   (IX+ZN_PHASE),A
LD   (IX+ZN_SEEN),A
ZN_VHEAD:
CALL ZN_RCRC
JP   C,ZN_FIO
LD   (IX+ZN_KIND),A
CALL ZN_RCRC
JP   C,ZN_FIO
LD   (IX+ZN_LENLO),A
CALL ZN_RCRC
JP   C,ZN_FIO
LD   (IX+ZN_LENHI),A
LD   L,(IX+ZN_CNTLO)
LD   H,(IX+ZN_CNTHI)
INC  HL
LD   (IX+ZN_CNTLO),L
LD   (IX+ZN_CNTHI),H
LD   A,H
OR   L
JP   Z,ZN_FCOUNT
LD   A,(IX+ZN_KIND)
CP   ZN_BEGIN
JP   Z,ZN_VBEGIN
CP   ZN_IMAGE
JP   Z,ZN_VIMAGE
CP   ZN_PATCH
JP   Z,ZN_VPATCH
CP   ZN_MAP
JP   Z,ZN_VMAP
CP   ZN_COMMIT
JP   Z,ZN_VCOMMIT
JP   ZN_FFRAME

ZN_VBEGIN:
LD   A,(IX+ZN_PHASE)
OR   A
JP   NZ,ZN_FORDER
LD   L,(IX+ZN_LENLO)
LD   H,(IX+ZN_LENHI)
LD   DE,6
OR   A
SBC  HL,DE
JP   C,ZN_FFRAME
LD   (IX+ZN_REMLO),L
LD   (IX+ZN_REMHI),H
CALL ZN_RCRC
JP   C,ZN_FIO
CP   'N'
JP   NZ,ZN_FFRAME
CALL ZN_RCRC
JP   C,ZN_FIO
CP   'O'
JP   NZ,ZN_FFRAME
CALL ZN_RCRC
JP   C,ZN_FIO
CP   'B'
JP   NZ,ZN_FFRAME
CALL ZN_RCRC
JP   C,ZN_FIO
CP   'J'
JP   NZ,ZN_FFRAME
CALL ZN_RCRC
JP   C,ZN_FIO
CP   (IX+ZN_MAJOR)
JP   NZ,ZN_FVER
CALL ZN_RCRC
JP   C,ZN_FIO
CP   (IX+ZN_MINOR)
JP   NZ,ZN_FVER
CALL ZN_SKIPC
JP   C,ZN_FIO
LD   (IX+ZN_PHASE),1
JP   ZN_VHEAD

ZN_VIMAGE:
LD   A,(IX+ZN_PHASE)
CP   1
JP   NZ,ZN_FORDER
LD   (IX+ZN_SEEN),1
CALL ZN_SETREM
CALL ZN_SKIPC
JP   C,ZN_FIO
JP   ZN_VHEAD

ZN_VPATCH:
LD   A,(IX+ZN_SEEN)
OR   A
JP   Z,ZN_FORDER
LD   A,(IX+ZN_PHASE)
CP   1
JR   Z,ZN_VPATCH0
CP   2
JP   NZ,ZN_FORDER
ZN_VPATCH0:
LD   (IX+ZN_PHASE),2
CALL ZN_SETREM
CALL ZN_SKIPC
JP   C,ZN_FIO
JP   ZN_VHEAD

ZN_VMAP:
LD   A,(IX+ZN_PHASE)
CP   1
JR   Z,ZN_VMAP0
CP   2
JP   NZ,ZN_FORDER
ZN_VMAP0:
BIT  0,(IX+ZN_FLAGS)
JR   Z,ZN_VMAP1
LD   A,(IX+ZN_SEEN)
OR   A
JP   Z,ZN_FORDER
ZN_VMAP1:
LD   (IX+ZN_PHASE),3
CALL ZN_SETREM
CALL ZN_SKIPC
JP   C,ZN_FIO
JP   ZN_VHEAD

ZN_VCOMMIT:
LD   A,(IX+ZN_PHASE)
CP   3
JP   NZ,ZN_FORDER
LD   A,(IX+ZN_LENLO)
CP   7
JP   NZ,ZN_FFRAME
LD   A,(IX+ZN_LENHI)
OR   A
JP   NZ,ZN_FFRAME
CALL ZN_RCRC
JP   C,ZN_FIO
LD   (IX+ZN_REMLO),A
CALL ZN_RCRC
JP   C,ZN_FIO
LD   (IX+ZN_REMHI),A
LD   L,(IX+ZN_CNTLO)
LD   H,(IX+ZN_CNTHI)
LD   E,(IX+ZN_REMLO)
LD   D,(IX+ZN_REMHI)
OR   A
SBC  HL,DE
JP   NZ,ZN_FCOUNT
CALL ZN_RCRC
JP   C,ZN_FIO
LD   (IX+ZN_ENTBNK),A
CALL ZN_RCRC
JP   C,ZN_FIO
LD   (IX+ZN_ENTLO),A
CALL ZN_RCRC
JP   C,ZN_FIO
LD   (IX+ZN_ENTHI),A
CALL ZN_READ
JP   C,ZN_FIO
LD   (IX+ZN_REMLO),A
CALL ZN_READ
JP   C,ZN_FIO
LD   (IX+ZN_REMHI),A
LD   L,(IX+ZN_CRCLO)
LD   H,(IX+ZN_CRCHI)
LD   E,(IX+ZN_REMLO)
LD   D,(IX+ZN_REMHI)
OR   A
SBC  HL,DE
JP   NZ,ZN_FCRC
CALL ZN_READ
JP   NC,ZN_FFRAME
CP   ZN_EOF
JP   NZ,ZN_FIO
LD   (IX+ZN_PHASE),4
XOR  A
RET

; Validate and apply one stored NOBJ generation.
;@ROUTINE IN IX OUT A,CARRY CLOBBERS BC,DE,HL,ZERO,SIGN,PARITY,HALFCARRY
ZN_MAT:
CALL ZN_VALID
RET  C
CALL ZN_PROF
JP   C,ZN_FPROF
CALL ZN_INIT
JP   C,ZN_FSTORE
CALL ZN_REW
JP   C,ZN_FIO
ZN_MHEAD:
CALL ZN_READ
JP   C,ZN_FIO
LD   (IX+ZN_KIND),A
CALL ZN_READ
JP   C,ZN_FIO
LD   (IX+ZN_LENLO),A
CALL ZN_READ
JP   C,ZN_FIO
LD   (IX+ZN_LENHI),A
LD   A,(IX+ZN_KIND)
CP   ZN_IMAGE
JR   Z,ZN_MDATA
CP   ZN_PATCH
JR   Z,ZN_MDATA
CP   ZN_COMMIT
JR   Z,ZN_MDONE
CALL ZN_SETREM
CALL ZN_SKIP
JP   C,ZN_FIO
JR   ZN_MHEAD

ZN_MDATA:
LD   L,(IX+ZN_LENLO)
LD   H,(IX+ZN_LENHI)
LD   DE,3
OR   A
SBC  HL,DE
JP   C,ZN_FFRAME
LD   (IX+ZN_REMLO),L
LD   (IX+ZN_REMHI),H
CALL ZN_READ
JP   C,ZN_FIO
LD   (IX+ZN_BANK),A
CALL ZN_READ
JP   C,ZN_FIO
LD   (IX+ZN_ADDRLO),A
CALL ZN_READ
JP   C,ZN_FIO
LD   (IX+ZN_ADDRHI),A
ZN_MBYTE:
LD   L,(IX+ZN_REMLO)
LD   H,(IX+ZN_REMHI)
LD   A,H
OR   L
JR   Z,ZN_MHEAD
DEC  HL
LD   (IX+ZN_REMLO),L
LD   (IX+ZN_REMHI),H
CALL ZN_READ
JP   C,ZN_FIO
LD   B,(IX+ZN_BANK)
LD   E,(IX+ZN_ADDRLO)
LD   D,(IX+ZN_ADDRHI)
CALL ZN_STORE
JP   C,ZN_FSTORE
LD   L,(IX+ZN_ADDRLO)
LD   H,(IX+ZN_ADDRHI)
INC  HL
LD   (IX+ZN_ADDRLO),L
LD   (IX+ZN_ADDRHI),H
JR   ZN_MBYTE
ZN_MDONE:
XOR  A
RET

; Set the remaining-byte counter from the current record length.
;@ROUTINE IN IX OUT A CLOBBERS HL,ZERO,SIGN,PARITY,HALFCARRY
ZN_SETREM:
LD   L,(IX+ZN_LENLO)
LD   H,(IX+ZN_LENHI)
LD   (IX+ZN_REMLO),L
LD   (IX+ZN_REMHI),H
RET

; Skip the remaining bytes while updating the validation CRC.
;@ROUTINE IN IX OUT A,CARRY CLOBBERS BC,DE,HL,ZERO,SIGN,PARITY,HALFCARRY
ZN_SKIPC:
LD   L,(IX+ZN_REMLO)
LD   H,(IX+ZN_REMHI)
LD   A,H
OR   L
RET  Z
DEC  HL
LD   (IX+ZN_REMLO),L
LD   (IX+ZN_REMHI),H
CALL ZN_RCRC
RET  C
JR   ZN_SKIPC

; Skip the remaining bytes without updating the CRC.
;@ROUTINE IN IX OUT A,CARRY CLOBBERS BC,DE,HL,ZERO,SIGN,PARITY,HALFCARRY
ZN_SKIP:
LD   L,(IX+ZN_REMLO)
LD   H,(IX+ZN_REMHI)
LD   A,H
OR   L
RET  Z
DEC  HL
LD   (IX+ZN_REMLO),L
LD   (IX+ZN_REMHI),H
CALL ZN_READ
RET  C
JR   ZN_SKIP

; Read one byte and fold it into CRC-16/CCITT-FALSE.
;@ROUTINE IN IX OUT A,CARRY CLOBBERS BC,DE,HL,ZERO,SIGN,PARITY,HALFCARRY
ZN_RCRC:
CALL ZN_READ
RET  C
LD   C,A
LD   L,(IX+ZN_CRCLO)
LD   H,(IX+ZN_CRCHI)
XOR  H
LD   H,A
LD   B,8
ZN_CRCLP:
ADD  HL,HL
JR   NC,ZN_CRCNX
LD   A,H
XOR  $10
LD   H,A
LD   A,L
XOR  $21
LD   L,A
ZN_CRCNX:
DJNZ ZN_CRCLP
LD   (IX+ZN_CRCLO),L
LD   (IX+ZN_CRCHI),H
LD   A,C
OR   A
RET

ZN_FIO:
LD   A,ZN_IO
SCF
RET
ZN_FFRAME:
LD   A,ZN_FRAME
SCF
RET
ZN_FVER:
LD   A,ZN_VER
SCF
RET
ZN_FORDER:
LD   A,ZN_ORDER
SCF
RET
ZN_FCOUNT:
LD   A,ZN_COUNT
SCF
RET
ZN_FCRC:
LD   A,ZN_CRC
SCF
RET
ZN_FPROF:
LD   A,ZN_PROFILE
SCF
RET
ZN_FSTORE:
LD   A,ZN_STOREE
SCF
RET

ZN_END:
