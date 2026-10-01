/** Library entries that need exactly one "no bond" pair, keyed by id, with the pair in SMILES atom indices (05 §6.2, 09 §2.1). */
export const NEEDS_SUPPRESSION: Readonly<Record<string, readonly [number, number]>> = {
  'z-but-2-ene': [0, 3],
  'z-hex-3-ene': [1, 4],
  'z-2-chlorobut-2-ene': [0, 3],
  'e-2-chlorobut-2-ene': [0, 4],
  'e-3-methylpent-2-ene': [0, 3],
  'z-3-methylpent-2-ene': [0, 4],
  'z-1-2-dichloroethene': [0, 3],
  'e-1-2-dibromobut-1-ene': [0, 4],
};
