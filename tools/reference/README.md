# Reference scripts (development only)

Python + RDKit scripts written during the design research. They are not part
of the shipped game. They serve two purposes:

1. **Reference implementations to port to TypeScript**: `refimpl.py` (SMILES
   subset parser, implicit hydrogens, Morgan-style canonical hash, VF2
   isomorphism), `cipref.py` (CIP ranking over the hierarchical digraph, R/S
   from grid vectors, E/Z from grid vectors), `embed.py` (BFS embedding of a
   molecule graph onto the cubic lattice), `arom_test.py` (six-ring
   aromaticity perception on Kekulé graphs).
2. **Content validation against RDKit**: `verify.py`, `verify2.py`,
   `verify_library.py`, `verify_smarts.py`, `fg.py` check the molecule
   library formulas, canonical SMILES, CIP labels and the functional group
   SMARTS rules.

Run with `python3 <script>.py` from this folder. Requires `rdkit`.
