# Solve reconstruction SSOT

All solve analytics consume one authoritative `MoveTimeline`. UI components
must not independently infer CFOP boundaries from the current frame.

```text
GAN live/history move
  → CubeClock (uint32 unwrap + host anchor)
  → ordered MoveTimeline entry (before/after CubeState)
  → stable CFOP milestone reconstruction
  → case / split / TPS / pause / replay / efficiency report
```

## Continuity

History-recovered moves retain `source: history` and have no fabricated device
timestamp. If history recovery fails and a snapshot is used, a
`TimelineDiscontinuity` is inserted. A timeline containing that boundary is
never reported as a complete reconstruction, even when its last snapshot is a
solved cube.

## CFOP boundaries

Milestones use stable suffixes instead of the first transient match:

- Cross: first move after which Cross remains solved;
- F2L: first move after which all four slots remain solved;
- OLL: first move after which F2L and last-layer orientation remain solved;
- PLL: the remaining suffix through the solved state.

This prevents an early Cross/OLL match that is broken by a later move from
prematurely advancing the report.

## Computations

- phase duration and TPS use cube timestamps when available;
- pauses are inter-move device-time gaps of at least 700 ms;
- replay uses the exact `stateBefore/stateAfter` snapshots stored per move;
- OLL/PLL recognition canonicalizes all four AUF states and always returns a
  stable signature, with standard names where a verified algorithm fixture is
  registered;
- algorithm comparison removes whole-cube `x/y/z` rotations, combines same-face
  turns and compares the core independently from pre/post AUF;
- F2L pair completion is stable through the F2L boundary;
- Cross search uses HTM IDDFS up to the standard 8-move bound and prunes
  duplicate same-face/opposite-face orders.
