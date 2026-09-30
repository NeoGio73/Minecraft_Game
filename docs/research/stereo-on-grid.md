# Research: stereo-on-grid

_Source: workflow agent `research:stereo-on-grid`._

## Summary

Stereochemistry on the cubic voxel grid is fully computable and the key idea in the task is CONFIRMED with one important correction: for a carbon with three explicit substituents and an implicit H, handedness is well-defined only when the three explicit direction vectors are mutually orthogonal (an "octant" trio, 8 of the 20 possible trios); if two of them are opposite each other (a "T" trio, 12 of 20) the implicit H could go up or down and the center must be reported as unspecified/drawn-flat (the ChemDraw "no wedge" situation), not silently assigned. With four explicit substituents, 12 of the 15 possible quads ("seesaw") have definite handedness and 3 ("square planar") are flat. The single formula V = ((a2-a1)x(a3-a1))·(a4-a1) over the four substituent positions in CIP priority order (implicit H placed at -(v1+v2+v3)) gives R for V>0, S for V<0, planar for V=0, and was verified against RDKit's Hanson-style CIP labeler on 178 stereocenters (3D conformers), every hand-built grid arrangement, and a 27-heavy-atom steroid. A reference Rule-1a hierarchical-digraph CIP implementation (duplicate atoms for multiple bonds and ring closures, breadth-first sphere-by-sphere comparison with branches ordered by recursive rank) reproduced RDKit on all true chirality centers; the only differences were pseudo-asymmetric ring carbons (RDKit r/s), which the game should report as "not a chirality center / cannot assign", consistent with McMurry's first-semester definition. E/Z on the grid reduces to: each alkene carbon's two substituents must be perpendicular to the C=C axis and opposite each other, both ends in one grid plane, then Z if the higher-priority substituent vectors have positive dot product, E if negative. SMILES conventions were pinned numerically: '@' means the signed volume of the neighbors in written order (preceding atom, implicit H, ring-closure digits in digit order, then branches) is negative, '@@' positive; '/' '\' sides follow the OpenSMILES "relative to the carbon" rule. The recommended comparison of a student molecule to a stereo target is graph isomorphism plus per-atom signed-volume parity and per-bond cis/trans comparison (falls out of the same math, handles meso, 1,4-disubstituted rings and pseudo-asymmetric cases), with CIP labels used only for feedback text ("your molecule is the S enantiomer"). Verified target SMILES for all requested textbook cases are tabulated, including the SMILES gotcha that meso-2,3-dibromobutane is C[C@H](Br)[C@H](Br)C (same tags) and cis-1-bromo-2-methylcyclohexane is (1R,2S)/(1S,2R). Cyclohexane should be built as the cube's skew "chair" hexagon (all ring bonds orthogonal at every vertex) so ring stereocenters are not T-shaped. NOTE FOR THE ORCHESTRATOR: the relayed user message says "Wait, you didn't ask me what topics should be included." The topic list this research was scoped against was presented as instructor-chosen but the user indicates they were not consulted; confirm the v1 topic list with the user before treating this spec's challenge scope as final.

## Design specification

# Stereochemistry engine for the voxel builder (McMurry ch. 5 and 7)

Scope note. The relayed user message says the user was not asked which topics to include. Everything below implements the stereochemistry topic exactly as the computed task scoped it; the orchestrator should confirm the v1 topic list with the user before locking the challenge content in section 8.

Reference code produced and tested during this research (Python, written to be ported line-by-line to TypeScript; may not survive the session):
- /tmp/claude-0/-home-user-Minecraft-Game/8f0480a6-ca12-5fe0-96b2-f372903d1e22/scratchpad/cipref.py (CIP ranking, R/S from vectors, E/Z from grid)
- .../scratchpad/test1.py, test2.py, test3.py, test3c.py, lib.py (RDKit cross-checks whose results are quoted below)

Conventions used throughout: positions are integer voxel coordinates; a "direction vector" v = pos(neighbor) - pos(center); on the plain face-adjacent grid every v is one of the six unit vectors D6 = {+x,-x,+y,-y,+z,-z}. All formulas are written with an epsilon so they also work if diagonal (edge-adjacent) bonds are enabled later.

---------------------------------------------------------------------
## 1. Tetrahedral centers: geometry math (confirmation + correction)

### 1.1 Data needed per candidate center
```
interface Atom { id: number; Z: number; pos: Vec3; explicitBonds: {to: number; order: 1|2|3}[]; implicitH: number }
```
A candidate stereocenter is a carbon with exactly four sigma partners counting implicit H (degree + implicitH == 4, no double/triple bonds). Explicit H blocks are ordinary neighbors with Z = 1. (N, P, S centers are out of scope: McMurry 5.10.)

### 1.2 The signed-volume test (the "handedness" of four directions)
Let a1..a4 be the tip positions of the four substituents ordered by CIP priority 1 (highest) .. 4 (lowest); with the center c, a_i = c + v_i.

    n  = (a2 - a1) x (a3 - a1)        // normal of the plane through tips 1,2,3
    V  = n · (a4 - a1)                 // signed volume of tetrahedron (1,2,3,4), times 6

    V >  eps  ->  R
    V < -eps  ->  S
    |V| <= eps -> PLANAR (no handedness)

Verified: on 178 chirality centers of RDKit ETKDG conformers and on all hand-built grid cases the label from this rule equals RDKit's Hanson-style CIP label (test1.py, test2.py). Derivation of the sign: the viewer stands on the side opposite substituent 4 and looks along v4; 1->2->3 appears clockwise iff n·v4 > 0, and for any tetrahedral or grid arrangement n·v4 has the same sign as n·(a4 - a1). Because c cancels, V can be computed from direction vectors alone: V = ((v2-v1) x (v3-v1)) · (v4-v1).

Why V is the right invariant: the sign of V is constant under any continuous deformation that never passes through a planar arrangement, so every non-planar four-direction arrangement (including the grid "seesaw" ones with two substituents at 180 degrees) is unambiguously equivalent to one of the two ideal tetrahedral enantiomers. The game therefore treats any non-planar arrangement as a legitimate (distorted) tetrahedron.

### 1.3 Implicit hydrogen as substituent 4
Rule: an implicit H is always priority 4 (Z = 1 is the lowest atomic number present at a carbon center; if there are two implicit or explicit H the atom is not a center). Its position is unknown, so place it at the virtual tip

    a4 := c - (v1 + v2 + v3)          // i.e. v4 = -(v1+v2+v3)

Then V = -4 · det[v1, v2, v3] (proof: with n the normal of the tip plane, n·v1 = n·v2 = n·v3 because the tips are coplanar, hence n·(a4-a1) = -3 n·v1 - n·v1 = -4 n·v1 = -4 v1·(v2 x v3)). So for implicit H simply:

    det = v1 · (v2 x v3)   (priority order 1,2,3)
    det < -eps -> R ; det > eps -> S ; |det| <= eps -> UNSPECIFIED (drawn flat)

Well-definedness proof for "choose any free position" (the question in the task): placing H at a candidate free position h gives sign(n·(h - a1)), i.e. the side of the tip plane on which h lies. All candidate positions give the same answer iff they all lie strictly on the same side of the tip plane as the virtual tip, which on the grid happens iff the center c itself is NOT in the tip plane (det != 0). Exhaustive enumeration of the 20 trios of D6 (test3.py B):
- 8 "octant" trios (three mutually orthogonal vectors, e.g. {+x,+y,+z}): all three free positions and the virtual tip give the same sign. Well-defined.
- 12 "T" trios (contain an antiparallel pair, e.g. {+x,-x,+y}): the three free positions give +, -, and 0 (the position in the plane). NOT well-defined; det = 0. This is the exact analogue of a ChemDraw stereocenter drawn with three plain bonds and no wedge: configuration unspecified.
So: an implicit-H center is assignable iff its three explicit substituents are mutually orthogonal. Equivalent operational test on the plain grid: no two explicit substituent vectors are negatives of each other. (With diagonal bonds enabled use |det| > eps directly.)

### 1.4 Four explicit substituents
Exhaustive enumeration of the 15 four-subsets of D6: 12 "seesaw" sets (the two empty positions are orthogonal, e.g. {+x,-x,+y,+z}) have V != 0 and a definite handedness; the 3 "square planar" sets (the two empty positions are opposite, e.g. {+x,-x,+y,-y}) have V = 0. RDKit's AssignStereochemistryFrom3D on the same coordinates agrees in every case.

### 1.5 Classification table and player messages
| explicit substituents | shape | result | message |
|---|---|---|---|
| 3 mutually orthogonal + implicit H | octant | R/S computed | (none) |
| 3 with an opposite pair + implicit H | T | UNSPECIFIED | "This carbon is drawn flat: two of its groups are opposite each other and the hidden H could sit above or below. Bend the chain here (put the three groups at 90 degrees to each other) or place the H block explicitly above or below." |
| 4 explicit, empty positions orthogonal | seesaw | R/S computed | (none; optionally a soft geometry note from the hybridization module) |
| 4 explicit, empty positions opposite | square planar | UNSPECIFIED | "This carbon is drawn planar; move one substituent up or down to make it a real tetrahedral center." |
| any arrangement with two CIP-identical groups | – | NOT_CENTER | "Not a chirality center: two of the groups are the same." |

### 1.6 Full per-center pipeline
```
assignCenter(mol, c):
  ligs = rankLigands(mol, c)            // section 2; includes implicit H nodes
  if ligs.length != 4        -> NOT_CENTER
  if ligs.tie                -> NOT_CENTER  (or CANNOT_ASSIGN, see 2.6)
  v = ligs.map(l => l.atom === H_IMPLICIT ? null : pos(l.atom) - pos(c))
  if count(null) > 1         -> NOT_CENTER           // two H
  if count(null) == 1 and v[3] !== null -> internal error (implicit H must rank last)
  if v[3] === null: v[3] = -(v[0]+v[1]+v[2])
  V = ((v[1]-v[0]) x (v[2]-v[0])) · (v[3]-v[0])
  return |V|<=eps ? UNSPECIFIED : (V>0 ? 'R' : 'S')
```
Verified grid vectors for 2-butanol (C2 at origin, CH3 at -x, ethyl C at +y): O at +z -> S; O at -z -> R; CH3 -x, ethyl +x, O +y -> UNSPECIFIED; same plus explicit H at +z -> S, at -z -> R; explicit H at -y -> UNSPECIFIED; octant trio {+x(CH3), +y(Et), +z(O)} with explicit H at any of -x, -y, -z -> R in all three cases (test2.py A).

---------------------------------------------------------------------
## 2. CIP priority ranking (Rule 1a hierarchical digraph, implementation level)

### 2.1 What is implemented and what is not
Implemented: Rule 1a (atomic number) over the full hierarchical digraph (this is McMurry's Rules 1-3 combined: atomic number, first point of difference exploring outward, multiple bonds as duplicated atoms). Optional: Rule 2 (mass number; only if the game ever offers a deuterium block). Not implemented: Rules 3-5 (Z/E, like/unlike, R/S of substituents, r/s pseudo-asymmetry) - the engine must detect when they would be needed and say "cannot assign" (2.6). This covers every first-semester case in the task list.

### 2.2 Data structures
```
interface MolGraph {
  Z: number[];               // atomic numbers, index = atom id
  hImplicit: number[];       // implicit H count per atom
  adj: number[][];           // neighbor ids
  order: Map<string, 1|2|3>; // key `${min}-${max}`
  pos: Vec3[];
}
interface DNode {            // node of the hierarchical digraph
  atom: number;              // -1 = hydrogen node (implicit H)
  dup: boolean;              // duplicate atom (multiple bond or ring closure)
  parent: DNode | null;
  Z: number;                 // Z of the (duplicated) atom; 1 for H
  path: string;              // "atom:dup>atom:dup>..." from the root; used as memo key
}
```
Phantom atoms (Z = 0) are never materialized: a duplicate node has no children, and comparison pads shorter child lists with Z = 0. This is exactly IUPAC's "duplicated atoms carry three phantom atoms of atomic number zero".

### 2.3 children(node)
```
children(mol, node):
  if node.dup || node.atom === -1: return []          // duplicates and H carry only phantoms
  i = node.atom
  ancestors = set of real (non-dup) atoms on node.path   // includes the root center
  kids = []
  for j of mol.adj[i]:
     o = order(i,j)
     if node.parent && j === node.parent.atom && !node.parent.dup:
        push (o-1) duplicate nodes of j          // bond back to parent: only its multiplicity duplicates
        continue
     if ancestors.has(j): push 1 duplicate node of j      // ring closure -> duplicate atom
     else:                 push 1 real node of j
     push (o-1) duplicate nodes of j                      // double bond: +1 dup, triple: +2 dups
  push hImplicit[i] hydrogen nodes (atom -1, Z 1)
  return kids
```
Examples this yields: -CHO -> C with children (O, O-dup, H); -CH=CH2 -> C with (C, C-dup, H) and its C with (C-dup, H, H); -C≡CH -> C with (C, C-dup, C-dup) and next C with (C-dup, C-dup, H); a cyclohexane ring explored from C1 returns to C1 as a C-dup after five real atoms.

### 2.4 compare(a, b): breadth-first, sphere by sphere, hierarchical
```
compare(mol, a: DNode, b: DNode): -1 | 0 | 1         // 1 = a ranks higher
  memo by (a.path, b.path)
  la = [a]; lb = [b]
  loop:
    // (1) compare this sphere's atoms in hierarchical order, phantom padding
    for k in 0..max(la.length, lb.length)-1:
        za = la[k]?.Z ?? 0 ; zb = lb[k]?.Z ?? 0
        if za != zb: return za > zb ? 1 : -1
    // (2) expand: each node's children sorted best-first by FULL recursive compare
    ca = la.map(n => children(n).sort((p,q) => -compare(p,q)))
    cb = lb.map(n => children(n).sort((p,q) => -compare(p,q)))
    // (3) compare child sets parent-by-parent in hierarchical order (pad with Z=0)
    for k: for m in 0..max(ca[k].length, cb[k].length)-1:
        za = ca[k][m]?.Z ?? 0 ; zb = cb[k][m]?.Z ?? 0
        if za != zb: return za > zb ? 1 : -1
    la = flatten(ca); lb = flatten(cb)
    if la.length == 0 && lb.length == 0: return 0        // constitutionally identical ligands
    if la.length > 500 || lb.length > 500: return 0     // safety cap (never hit for <=30 heavy atoms)
```
Notes for correctness: (a) the sibling sort must use the full recursive compare, not just Z, because the ORDER in which branches are compared at the next sphere is set by their complete rank (this is what makes "3-methylbutan-2-yl > 3-pentyl" come out right: both are (C,C,H) at sphere 2; hierarchically their best branches (C,C,H) vs (C,H,H) decide at sphere 3; a flat multiset comparison would wrongly tie). (b) Step (1) is redundant after the first iteration but keeps the code obviously sphere-by-sphere. (c) Memoization on path strings makes this O(small): cholesterol (27 heavy atoms, 8 centers) ranks in ~10 ms in Python.

### 2.5 rankLigands(mol, center)
```
root = {atom: center, dup: false, parent: null, path: ""}
ligs = children(mol, root)                     // real neighbors (+ dups if multiple bonds) + implicit H nodes
ligs.sort((p,q) => -compare(p,q))              // best first -> priority 1..n
tie = exists i: compare(ligs[i], ligs[i+1]) == 0
return {ligs, tie}
```
For E/Z the same function is used on each alkene carbon with the partner across the double bond (and its duplicate) removed from ligs.

### 2.6 When to give up / what a tie means
- Tie between two ligands whose subgraphs contain no stereo elements (no other stereocenter, no stereo double bond) -> NOT_CENTER: "two identical groups". This matches McMurry's definition; it also (correctly for a first course) reports the ring carbons of cis/trans-1,4-dimethylcyclohexane and decalin fusion carbons as non-centers (RDKit gives them lowercase r/s via Rule 5).
- Tie where either tied ligand contains a stereocenter/stereo double bond -> CANNOT_ASSIGN: "priorities depend on advanced CIP rules (3-5) not covered in this course". The comparison in section 5 still works for such molecules because it never needs CIP.
- Size cap reached -> CANNOT_ASSIGN (log it; should not happen).
- Aromatic rings: the builder uses explicit bond orders, so benzene is a Kekulé structure and the digraph just uses the drawn double bonds. Phenyl then ranks as (C,C,C) at sphere 2, which is the textbook result. (True IUPAC treatment uses averaged duplicates for aromatics; irrelevant at this level.)
- Optional Rule 2 (isotopes): if a D block exists, run the same BFS a second time comparing mass numbers (H=1, D=2, others = most abundant isotope) only when Rule 1a returned 0.

### 2.7 Verified priority outcomes for the required textbook cases (RDKit-confirmed)
| molecule | center | priorities 1>2>3>4 |
|---|---|---|
| 2-butanol | C2 | OH > CH2CH3 > CH3 > H |
| 2-bromobutane | C2 | Br > CH2CH3 > CH3 > H |
| alanine | C2 | NH2 > COOH (O,O,O via dup) > CH3 > H |
| lactic acid | C2 | OH > COOH > CH3 > H |
| 2,3-dibromobutane | C2 (and C3) | Br > CHBrCH3 (Br,C,H) > CH3 > H |
| 3-methylhexane | C3 | CH2CH2CH3 > CH2CH3 (tie at sphere 2 (C,H,H); propyl wins at sphere 3 (C,H,H) vs (H,H,H)) > CH3 > H |
| 1-bromo-2-methylcyclohexane | C1 | Br > C2 (C,C,H) > C6 (C,H,H) > H ; C2: C1 (Br,C,H) > C3 (C,H,H) > CH3 > H |
| glyceraldehyde | C2 | OH > CHO (O,O,H) > CH2OH (O,H,H) > H |
| but-3-en-2-ol | C2 | OH > CH=CH2 (C,C,H) > CH3 > H |
| 3-methylcyclohexene | C3 | CH=CH (C,C,H) > CH2 ring > CH3 > H |
| 2-methylcyclohexanone | C2 | C(=O) (O,O,C) > CH2 ring > CH3 > H |

---------------------------------------------------------------------
## 3. E/Z on the grid

### 3.1 Geometry requirements
For a double bond Ca=Cb let u = pos(Cb) - pos(Ca). For each end C with partner P (the other alkene carbon):
1. ligs = rankLigands(C) minus the partner and its duplicate. Must be exactly 2 (an alkene carbon has 3 sigma partners incl. implicit H).
2. If compare(ligs[0], ligs[1]) == 0 -> NO_EZ ("two identical groups on this carbon; no E/Z isomerism", McMurry 7.3). E.g. 2-methylbut-2-ene, propene, terminal =CH2.
3. Each explicit substituent vector s must be perpendicular to the axis: s·u == 0 (|s·u| < eps). Otherwise COLLINEAR: "this group lies in line with the double bond; an sp2 carbon is trigonal, move the group to the side (up/down/left/right of the carbon)". This deliberately rejects a straight-line C-C=C-C build and teaches the zigzag/120-degree picture. (A lenient mode is described in 3.4.)
4. If two explicit substituents: they must be opposite each other, s1 == -s2 (i.e. s1·s2 = -|s1||s2|). Otherwise NOT_PLANAR ("the two groups on this carbon are 90 degrees apart; they must be on opposite sides of the double bond, in one plane").
5. If one explicit substituent + one implicit H: H is at -s (opposite side). If zero explicit: two H -> NO_EZ.
6. Both ends must lie in one plane containing the axis: for the reference perpendicular vectors sa (on Ca) and sb (on Cb), |sa·sb| must equal |sa||sb| (on the plain grid: sa·sb != 0). Otherwise TWISTED ("the two ends of the double bond are in perpendicular planes; a pi bond needs both ends coplanar").

### 3.2 Assignment
    pa = vector of the higher-priority substituent on Ca (from CIP ranks)
    pb = vector of the higher-priority substituent on Cb
    d  = pa·pb           // components along u are zero by 3.1
    d > 0 -> Z (same side; German zusammen)
    d < 0 -> E (opposite; entgegen)
cis/trans is the same test applied to the two chain-continuation substituents instead of the CIP-highest ones; for disubstituted alkenes with H on each carbon the two tests coincide. Report both words in feedback: "E (trans)".
Verified grid layouts (test2.py C): but-2-ene C1(0,1,0) C2(0,0,0) C3(1,0,0) C4(1,-1,0) -> E; C4(1,1,0) -> Z; C4(1,0,1) -> TWISTED; straight line -> COLLINEAR; C1(0,0,1),C4(1,0,-1) -> E; all agree with RDKit perception from the same coordinates.

### 3.3 Ring double bonds
Skip E/Z evaluation and the geometry flags for a double bond whose two atoms share a ring of size <= 7 (find via BFS for the shortest cycle through the bond). Such bonds are necessarily cis and McMurry does not label them. Practical layout hint for cyclohexene on the grid: use the planar 3x2 rectangle with the double bond on a SHORT edge (both ring neighbors then sit perpendicular to the axis and on the same side); the cube-chair layout of 4.1 makes the ring neighbors of a C=C lie in perpendicular planes and would be flagged TWISTED if the exemption were not applied.

### 3.4 Optional lenient mode (config flag ezAllowCollinear)
If instructors find the strict trigonal requirement too harsh: on an end with substituents {-u direction, s perpendicular}, treat the collinear one as being on the side opposite to s. Every other check stays. Off by default; the strict mode is recommended because it doubles as the sp2 geometry lesson.

---------------------------------------------------------------------
## 4. Rings: cis/trans faces and recommended cyclohexane layout

### 4.1 Layout facts
The face-adjacent lattice is bipartite, so only even rings exist. Six-cycles come in three shapes: planar 3x2 rectangle (its two "middle" atoms have collinear ring bonds -> any substituent there gives a T trio, so those atoms can never be assignable centers unless the H is placed explicitly above/below, and with explicit H they become square planar), the skew "chair" = Petrie hexagon of a unit cube, e.g. (0,0,0),(1,0,0),(1,1,0),(1,1,1),(0,1,1),(0,0,1) (edges +x,+y,+z,-x,-y,-z; ring bonds orthogonal at every vertex), and the "boat" (0,0,0),(1,0,0),(1,1,0),(0,1,0),(0,1,1),(0,0,1). Library layouts and the tutorial should use the chair: at every chair vertex exactly two free positions are perpendicular to both ring bonds and these are the ring's "up" and "down" faces.

### 4.2 Face of a substituent
    centroid = mean(ring positions)
    normal   = sum over consecutive ring atoms k of (p_k - centroid) x (p_{k+1} - centroid), normalized   // Newell method
    face(sub at ring atom r) = sign( (pos(sub) - pos(r)) · normal )     // +1 up, -1 down, 0 = in-plane (flag)
cis = same sign, trans = opposite sign. For the chair above the normal is (1,-1,1)/sqrt3 and the up positions are: atom0 -y, atom1 +z, atom2 +x, atom3 -y, atom4 +z, atom5 +x (test2.py E). This face test is independent of CIP and works for 1,2-, 1,3- and 1,4-disubstituted rings, including 1,4 where no atom is a chirality center.

### 4.3 Verified ring case: 1-bromo-2-methylcyclohexane (Br on ring atom 0, CH3 on ring atom 1 of the chair)
| build | labels (C-Br, C-Me) | relation |
|---|---|---|
| both up | (1S,2R) | cis |
| both down | (1R,2S) | cis |
| Br up, Me down | (1S,2S) | trans |
| Br down, Me up | (1R,2R) | trans |
So cis = (1R,2S)/(1S,2R) (a chiral pair, NOT meso because Br != CH3) and trans = (1R,2R)/(1S,2S). Cross-checked by RDKit from the grid coordinates and by ring-normal analysis of an MMFF chair. (cis-1,2-dimethylcyclohexane, by contrast, is meso.)

---------------------------------------------------------------------
## 5. Stereo targets from SMILES and comparison with the student's build

### 5.1 Parsing tetrahedral chirality (@ / @@)
While parsing a bracket atom that carries @ or @@, record its neighbor list in this order (OpenSMILES; RDKit-verified):
1. the preceding atom (the atom this one was reached from), if any;
2. its implicit H, if the bracket contains H (e.g. [C@H]) - "considered to be the first atom in the accounting" after the preceding atom;
3. ring-closure bonds in the order their digits appear immediately after the bracket (the position of the DIGIT on this atom, regardless of where the partner atom occurs in the string);
4. then branch atoms and the next chain atom, in string order.
If the chiral atom is the first atom of the SMILES, there is no preceding atom and the implicit H (if any) comes first: [C@H](F)(Cl)Br == F[C@@H](Cl)Br (RDKit canonical SMILES agree).
Store parity p(atom) = +1 for '@@', -1 for '@'. Meaning (verified numerically with N[C@@H](C)C(=O)O, V = +8.1, and N[C@H](C)C(=O)O, V = -8.1):

    V(n1, n2, n3, n4) = ((n2-n1) x (n3-n1)) · (n4-n1)  computed from any valid 3D geometry
    '@@'  <=>  V > 0        '@'  <=>  V < 0

Consistency with section 1: '@' means "looking from n1 toward the center, n2->n3->n4 anticlockwise"; reordering to (p4, p1, p2, p3) puts the lowest group toward the viewer, so anticlockwise-from-p4 = clockwise-with-p4-away = R; the cyclic shift to (p1,p2,p3,p4) is an odd permutation and flips the sign, giving R <=> V(p1,p2,p3,p4) > 0, which is exactly rule 1.2.
To label a SMILES target: rank the four neighbors with section 2 (implicit H node included), let sigma be the permutation from written order to priority order, then Vp = p · sign(sigma); Vp > 0 -> R, < 0 -> S. Check: L-alanine N[C@@H](C)C(=O)O: written (N,H,CH3,COOH), p=+1; priority (N,COOH,CH3,H) is one transposition, sign -1, Vp = -1 -> S (McMurry: (S)-alanine; RDKit: S).

### 5.2 Parsing double-bond geometry (/ and \)
A direction character sits on a single bond adjacent to a double bond. Define side(X relative to alkene carbon C):
| X written before C (X/C or X\C) | X written after C (C/X, C\X or C(/X), C(\X)) |
|---|---|
| '/' -> X is DOWN relative to C | '/' -> X is UP |
| '\' -> X is UP | '\' -> X is DOWN |
Two substituents on opposite ends are cis iff their sides are equal. Checks against the spec and RDKit: F/C=C/F: first F down, second F up -> trans (E); F/C=C\F -> both down -> cis (Z); C(\F)=C/F -> F down, F up -> E; C/C(\F)=C/F -> methyl down and F down on the same carbon -> reject as invalid (spec: "invalid SMILES"). One marked substituent per end suffices; the unmarked partner on that end is on the opposite side. Store for each stereo double bond: (refA, refB, cis: boolean). Directional bonds on ring-closure digits: not supported in v1; validate the library so none occur.
To label a target E/Z: rank the two substituents on each end (section 2); Z iff the CIP-highest substituents are cis.

### 5.3 Normalizing the student's build
- Merge explicit H blocks into implicit counts for graph matching, but remember their positions.
- Build MolGraph for both target (SMILES, no coordinates) and student (grid).
- Compare molecular formula and heavy-atom graph first (cheap reject), then run isomorphism.

### 5.4 Comparison = isomorphism + parity/cis comparison (recommended)
Do NOT compare coordinates. Do not even need CIP labels for the decision; compute the student's signed volumes in the TARGET's neighbor order:
```
for each isomorphism f: target -> student   (VF2 or backtracking: match Z, implicit H, degree, bond orders;
                                             molecules <= 30 heavy atoms, automorphism counts are small)
  tetra = []
  for each target atom t with parity p_t and written neighbor order (n1..n4)  // 'H' for implicit H
     L = (f(n1)..f(n4)) with 'H' -> virtual tip pos(f(t)) - sum of the three explicit vectors
     Vs = signed volume of L in student coordinates
     if |Vs| <= eps: return UNSPECIFIED(atom f(t))
     tetra.push(sign(Vs) == p_t)
  dbl = []
  for each target stereo double bond (refA, refB, cis)
     compute student sides of f(refA), f(refB) via section 3 (must pass geometry; else return INVALID_GEOMETRY(bond))
     dbl.push( (sideA == sideB) == cis )
  if all(tetra) && all(dbl):                   return SAME          // accept
  if tetra.length>0 && none(tetra) && all(dbl): candidate ENANTIOMER // mirror image inverts every center, keeps E/Z
  else                                          candidate DIASTEREOMER (record which centers/bonds differ under this f)
return best candidate in order SAME > ENANTIOMER > DIASTEREOMER; if no isomorphism: DIFFERENT_CONSTITUTION
```
Why this is right: the parity comparison is invariant under renumbering, an automorphism that maps one center onto another is tried explicitly, and meso targets are accepted from either "side" (verified: (2R,3S) vs (2S,3R) builds -> SAME; cis-1,4-dimethylcyclohexane built on either face -> SAME; cis vs trans -> DIASTEREOMER; (R,R) vs (S,S) -> ENANTIOMER; R- vs S-2-butanol -> ENANTIOMER; flat center -> UNSPECIFIED). Target atoms without @ at a real stereocenter are wildcards (skip). If the target has no stereo elements, SAME on constitution.
CIP labels (sections 1-3 on the student, 5.1/5.2 on the target) are computed separately and used ONLY for feedback strings and the HUD.

### 5.5 Alternative (simpler, less general): per-atom label comparison
Compute R/S and E/Z labels for both molecules, then for each isomorphism compare labels at mapped atoms/bonds, accepting if some isomorphism matches everywhere. Works for every molecule in section 8, fails for cis/trans-1,4-rings and pseudo-asymmetric cases (no labels). Use 5.4.

---------------------------------------------------------------------
## 6. Verified target library (RDKit 2026.03.6, Hanson-style labeler; atom numbers are 1-based positions in the SMILES)
| name | SMILES | labels |
|---|---|---|
| (R)-2-butanol | C[C@@H](O)CC | C2 R |
| (S)-2-butanol | C[C@H](O)CC | C2 S |
| (R)-2-bromobutane | C[C@@H](Br)CC | C2 R |
| (S)-2-bromobutane | C[C@H](Br)CC | C2 S |
| (S)-alanine (L, natural, (+)) | N[C@@H](C)C(=O)O | C2 S |
| (R)-alanine | N[C@H](C)C(=O)O | C2 R |
| (S)-lactic acid (L, (+)) | C[C@H](O)C(=O)O | C2 S |
| (R)-lactic acid ((-)) | C[C@@H](O)C(=O)O | C2 R |
| (R)-glyceraldehyde (D) | O=C[C@H](O)CO | C3 R |
| (S)-glyceraldehyde (L, (-)) | O=C[C@@H](O)CO | C3 S |
| meso-2,3-dibromobutane (2R,3S) | C[C@H](Br)[C@H](Br)C | C2 S, C4 R; self-mirror |
| (2R,3R)-2,3-dibromobutane | C[C@@H](Br)[C@H](Br)C | R,R |
| (2S,3S)-2,3-dibromobutane | C[C@H](Br)[C@@H](Br)C | S,S |
| (R)-3-methylhexane | CCC[C@H](C)CC | C4 R |
| (S)-3-methylhexane | CCC[C@@H](C)CC | C4 S |
| cis-1-bromo-2-methylcyclohexane (1R,2S) | C[C@H]1CCCC[C@H]1Br | C2(Me) S, C7(Br) R |
| cis-1-bromo-2-methylcyclohexane (1S,2R) | C[C@@H]1CCCC[C@@H]1Br | C2 R, C7 S |
| trans-1-bromo-2-methylcyclohexane (1R,2R) | C[C@@H]1CCCC[C@H]1Br | R,R |
| trans-1-bromo-2-methylcyclohexane (1S,2S) | C[C@H]1CCCC[C@@H]1Br | S,S |
| cis-1,2-dimethylcyclohexane (meso) | C[C@H]1CCCC[C@H]1C | S,R; self-mirror |
| trans-1,2-dimethylcyclohexane (R,R) / (S,S) | C[C@@H]1CCCC[C@H]1C / C[C@H]1CCCC[C@@H]1C | R,R / S,S |
| cis-1,4-dimethylcyclohexane (no chirality centers) | C[C@H]1CC[C@@H](C)CC1 | r,r pseudo; self-mirror |
| trans-1,4-dimethylcyclohexane | C[C@H]1CC[C@H](C)CC1 | self-mirror |
| meso-tartaric acid | OC(=O)[C@H](O)[C@H](O)C(=O)O | R,S; self-mirror |
| (2R,3R)-tartaric acid | OC(=O)[C@H](O)[C@@H](O)C(=O)O | R,R |
| L-threonine (2S,3R) | C[C@@H](O)[C@H](N)C(=O)O | C2 R, C4 S |
| (S)-2-methylcyclohexanone | C[C@H]1CCCCC1=O | C2 S |
| (R)-3-methylcyclohexene | C[C@H]1C=CCCC1 | C2 R |
| (R)-1-phenylethanol | C[C@@H](O)c1ccccc1 | C2 R (library must store a Kekulé form for the builder) |
| (R)-carvone (spearmint) | CC(=C)[C@@H]1CC=C(C)C(=O)C1 | C4 R |
| (E)-but-2-ene / (Z)-but-2-ene | C/C=C/C / C/C=C\C | E / Z |
| (E)-2-chloro-2-butene / (Z) | C/C=C(/Cl)C / C/C=C(\Cl)C | E / Z (McMurry 7.4 example compound) |
| (E)-3-methylpent-2-ene / (Z) | C/C=C(\C)CC / C/C=C(/C)CC | E / Z |
| (E)-1-bromo-1-chloropropene / (Z) | Br/C(Cl)=C/C / Br/C(Cl)=C\C | E / Z |
| (E)-hex-3-ene / (Z) | CC/C=C/CC / CC/C=C\CC | E / Z |
| (E)-pent-2-ene | C/C=C/CC | E |
| (2E,4E)-hexa-2,4-diene | C/C=C/C=C/C | E,E |
| (E)/(Z)-1,2-dichloroethene | Cl/C=C/Cl / Cl/C=C\Cl | E / Z |
| 2-methylbut-2-ene, propene | CC=C(C)C, CC=C | no E/Z |
Gotcha to document in the library README: for symmetric chains the meso form has the SAME @ tags (C[C@H](Br)[C@H](Br)C) because the neighbor order reverses along the chain; never hand-write meso SMILES by intuition, always verify with the parser + labeler unit test.

Display layouts (voxel coordinates) verified against both my algorithm and RDKit-from-3D:
- (S)-2-butanol: C1(-1,0,0) C2(0,0,0) O(0,0,1) C3(0,1,0) C4(0,2,0). (R): O at (0,0,-1).
- meso-2,3-dibromobutane (2R,3S): C1(0,-1,0) C2(0,0,0) Br(0,0,1) C3(1,0,0) Br(1,0,-1) C4(1,1,0). (2R,3R): both Br at +z: (0,0,1),(1,0,1).
- (E)-but-2-ene: (0,1,0),(0,0,0),(1,0,0),(1,-1,0). (Z): last atom (1,1,0).
- cis-(1S,2R)-1-bromo-2-methylcyclohexane: chair ring of 4.1, Br at (0,-1,0) (ring atom 0 up), CH3 at (1,0,1) (ring atom 1 up).

---------------------------------------------------------------------
## 7. Engine API (TypeScript)
```
type CenterLabel = 'R'|'S'|'UNSPECIFIED'|'NOT_CENTER'|'CANNOT_ASSIGN';
interface CenterReport { atom: number; label: CenterLabel; priorities?: number[] /* neighbor ids best-first, -1 = implicit H */; reason?: string; hint?: string; suggestedHPositions?: Vec3[] }
type BondLabel = 'E'|'Z'|'NO_EZ'|'RING'|'COLLINEAR'|'NOT_PLANAR'|'TWISTED';
interface BondReport { a: number; b: number; label: BondLabel; higherA?: number; higherB?: number; hint?: string }
interface StereoAnalysis { centers: CenterReport[]; bonds: BondReport[]; ringFaces: {ring: number[]; normal: Vec3; subs: {atom: number; ringAtom: number; face: 1|-1|0}[]}[] }
analyzeStereo(mol: MolGraph): StereoAnalysis
parseSmilesStereo(smiles: string): { graph: MolGraph; tetra: {atom: number; order: (number|'H')[]; parity: 1|-1}[]; dbl: {a: number; b: number; refA: number; refB: number; cis: boolean}[] }
compareStereo(target: ParsedTarget, student: MolGraph): { verdict: 'SAME'|'ENANTIOMER'|'DIASTEREOMER'|'UNSPECIFIED'|'INVALID_GEOMETRY'|'DIFFERENT_CONSTITUTION'; details: {...} }
```
Unit tests: port the tables in 1.6, 3.2, 4.3, 6 and the enumeration of 1.3/1.4 as fixtures; also add the RDKit-verified conformer test as a JSON fixture if the CI can run Python once to generate it.

---------------------------------------------------------------------
## 8. Challenge designs (stereochemistry)
Acceptance modes: absolute = verdict SAME; relative = SAME or ENANTIOMER (for cis/trans and "racemic" prompts); constitution = any stereo. Every challenge first requires constitution match (formula + isomorphism); stereo feedback is only shown after that.

| id | prompt | target | mode | feedback map |
|---|---|---|---|---|
| S1 | Build (R)-2-butanol | C[C@@H](O)CC | absolute | ENANTIOMER: "Right formula and connectivity, but your C2 is S: this is the enantiomer. Swap any two groups on C2 (e.g. move the OH from above to below)." UNSPECIFIED: message of 1.5 with the two candidate H positions highlighted. |
| S2 | Build (S)-2-bromobutane | C[C@H](Br)CC | absolute | as S1 |
| S3 | Build L-alanine, the natural (S) enantiomer | N[C@@H](C)C(=O)O | absolute | as S1; add "(S)-alanine is the (+) enantiomer (McMurry 5.5)". |
| S4 | Build (R)-3-methylhexane (priorities must be found at sphere 3) | CCC[C@H](C)CC | absolute | show the ranking table when wrong: "propyl beats ethyl at the third atom: (C,H,H) vs (H,H,H)". |
| S5 | Build the enantiomer of the shown molecule (show (S)-lactic acid layout) | mirror of shown = C[C@@H](O)C(=O)O | absolute | SAME-as-shown: "That is the same molecule, not its mirror image." Use only chiral shown molecules; if a meso/achiral molecule is shown the correct answer is the same molecule and the prompt should instead ask "Is this molecule chiral?" |
| S6 | Build meso-2,3-dibromobutane | C[C@H](Br)[C@H](Br)C | absolute (meso is self-mirror so any orientation passes) | DIASTEREOMER with labels (R,R)/(S,S): "You built the chiral (2R,3R)/(2S,3S) diastereomer. A meso compound has an internal mirror plane: make one center R and the other S." |
| S7 | Build (2R,3R)-2,3-dibromobutane | C[C@@H](Br)[C@H](Br)C | absolute | ENANTIOMER: "(2S,3S) - the enantiomer"; DIASTEREOMER: "that is meso (2R,3S)". |
| S8 | Build a diastereomer of the shown molecule (show (2R,3R)-tartaric acid) | verdict must be DIASTEREOMER vs shown | special | SAME: "identical"; ENANTIOMER: "that is the enantiomer, not a diastereomer". |
| S9 | Build cis-1-bromo-2-methylcyclohexane | C[C@H]1CCCC[C@H]1Br | relative | trans: "Br and CH3 are on opposite faces (trans). cis means the same face." Also show face arrows (section 9). Follow-up quiz: "Is your cis isomer (1R,2S) or (1S,2R)?" |
| S10 | Build trans-1,2-dimethylcyclohexane | C[C@@H]1CCCC[C@H]1C | relative | cis: "that is the meso cis isomer". |
| E1 | Build (E)-but-2-ene | C/C=C/C | absolute | Z: "Your molecule is Z (cis): the two CH3 groups are on the same side." COLLINEAR/TWISTED/NOT_PLANAR: hints of 3.1. |
| E2 | Build (Z)-2-chloro-2-butene (McMurry 7.4 example) | C/C=C(\Cl)C | absolute | E: "Cl (higher priority on C2) and CH3 (higher on C3) are on opposite sides -> E." |
| E3 | Build (E)-3-methylpent-2-ene | C/C=C(\C)CC | absolute | show the ethyl > methyl ranking when wrong. |
| E4 | Build (2E,4E)-hexa-2,4-diene | C/C=C/C=C/C | absolute | per-bond feedback. |
| Q1 | Identify: click each chirality center in the shown molecule (2-methylcyclohexanone, 3-methylhexane, methylcyclohexane [none], carvone) | list from analyzeStereo (labels R/S only) | – | wrong click: reason from 2.6 ("two identical groups"). |
| Q2 | Assign: is C2 R or S? (random library molecule shown) | label | – | reveal priority numbers on the atoms. |
| Q3 | How many stereoisomers does this compound have? (2^n minus meso) | count via enumerating parities of all centers, deduplicating with 5.4 | – | – |
Feedback string templates: "Your molecule is the {S} enantiomer of the target." / "Correct: {name} is ({labels})." / "C{n} is drawn flat (unspecified)." / "Double bond C{a}=C{b}: {Z} ({cis}); the target is {E}."

---------------------------------------------------------------------
## 9. Rendering hints (Three.js)
- Chirality centers: a translucent ring/halo (torus) around the atom cube, color by label: R blue, S orange, UNSPECIFIED yellow with a "?" sprite, CANNOT_ASSIGN grey. Sprite label "R"/"S" floating 0.8 block above the atom, always facing the camera; optional small priority digits 1-4 at the substituent midpoints when the player looks at the center (toggle key).
- Implicit H ghosts: for octant trios draw one small translucent H at a deterministic free position (first of -x,-y,-z order that is free); for T trios draw TWO faint H ghosts at the two perpendicular free positions with "?" to visualize the ambiguity; clicking a ghost places a real H there.
- Double bonds: draw two parallel cylinders offset in the substituent plane; draw the pi plane as a translucent quad (bond axis x perpendicular substituent direction, size 2x1 blocks); E/Z sprite at the bond midpoint; when TWISTED, draw both half-planes in red; when COLLINEAR, draw an arrow from the offending atom to the nearest perpendicular free position.
- Rings: on hover, show the ring mean plane as a translucent hexagonal disc and up/down arrows at substituents (cis/trans visualization); label "cis"/"trans" between the two substituents in S9/S10.
- Enantiomer feedback: overlay a mirrored ghost of the target (reflect through the plane x = const) next to the student's molecule so the mirror relationship is visible.
- Seesaw centers (two substituents at 180 degrees) are accepted; the hybridization module may show a soft note "real tetrahedral angles are 109.5 degrees" but must not block stereo assignment.

---------------------------------------------------------------------
## 10. Diagonal-bond readiness
If edge-adjacent bonds are enabled (18 directions), nothing in sections 1-5 changes except replacing exact-zero tests with |.| <= eps (1e-6 with unit-ish vectors), using the virtual tip for implicit H (already general), and in 3.1 using perpendicular components s_perp = s - (s·u/u·u)u with |s_perp| > eps and |s_perp_a · s_perp_b| == |s_perp_a||s_perp_b| (parallel planes) instead of the dot-nonzero shortcut.

## Facts

- [verified] McMurry (OpenStax 10e) section 5.5 states the CIP sequence rules as: Rule 1 'Look at the four atoms directly attached to the chirality center, and rank them according to atomic number' (heavier isotopes rank higher); Rule 2 'If a decision can't be reached by ranking the first atoms in the substituent, look at the second, third, or fourth atoms away from the chirality center until the first difference is found'; Rule 3 'Multiple-bonded atoms are equivalent to the same number of single-bonded atoms'. R/S: orient the lowest-ranked group away; 1->2->3 clockwise = R, counterclockwise = S. _(source: https://raw.githubusercontent.com/openstax/osbooks-organic-chemistry/main/modules/m00054/index.cnxml (OpenStax Organic Chemistry source, module 'Sequence Rules for Specifying Configuration'))_
- [verified] McMurry 5.5 worked examples: (-)-lactic acid is R (ranks -OH 1, -CO2H 2, -CH3 3, -H 4), (+)-lactic acid is S, (-)-glyceraldehyde is S, (+)-alanine is S; the text notes '(S)-Glyceraldehyde happens to be levorotatory (-), and (S)-alanine happens to be dextrorotatory (+)' and that there is no simple correlation between R,S and rotation sign. _(source: same module m00054)_
- [verified] McMurry 5.6: 'Diastereomers are stereoisomers that are not mirror images'; 'A molecule with n chirality centers can have up to 2^n stereoisomers'; 'Enantiomers have opposite configurations at all chirality centers, whereas diastereomers have opposite configurations at some (one or more) chirality centers but the same configuration at others.' Threonine has four stereoisomers (2R,3R)/(2S,3S) and (2R,3S)/(2S,3R). _(source: https://raw.githubusercontent.com/openstax/osbooks-organic-chemistry/main/modules/m00055/index.cnxml)_
- [verified] McMurry 5.7: 'Compounds, which are achiral, yet contain chirality centers, are called meso compounds.' Tartaric acid: (2R,3R) and (2S,3S) are enantiomers; (2R,3S) and (2S,3R) are the same (meso) compound; three stereoisomers total; 'The symmetry plane cuts through the C2-C3 bond'. cis-1,2-dimethylcyclobutane is meso. _(source: https://raw.githubusercontent.com/openstax/osbooks-organic-chemistry/main/modules/m00056/index.cnxml)_
- [verified] McMurry 5.2: a chirality center is 'a tetrahedral carbon atom bonded to four different groups'; carbons in -CH2-, -CH3, C=O, C=C and C≡C groups cannot be chirality centers; a molecule with a plane of symmetry in any conformation is achiral; 2-methylcyclohexanone C2 is a chirality center while methylcyclohexane C1 is not. _(source: https://raw.githubusercontent.com/openstax/osbooks-organic-chemistry/main/modules/m00051/index.cnxml)_
- [verified] McMurry 7.3 (Cis-Trans Isomerism in Alkenes): rotation about C=C requires breaking the pi bond (~350 kJ/mol); cis-trans isomerism requires both carbons of the double bond to bear two different groups; if either carbon bears two identical groups no such isomerism exists. _(source: https://raw.githubusercontent.com/openstax/osbooks-organic-chemistry/main/modules/m00066/index.cnxml)_
- [verified] McMurry 7.4 (E,Z designation): 'If the higher-ranked groups on each carbon are on the same side of the double bond, the alkene is said to have a Z configuration ... If the higher-ranked groups are on opposite sides, the alkene has an E configuration.' Worked example: left carbon H vs CH3 (CH3 higher by rule 1); right carbon -CH(CH3)2 vs -CH2OH tie by rule 1, -CH2OH higher by rule 2 (O as highest second atom); higher groups same side -> Z. _(source: https://raw.githubusercontent.com/openstax/osbooks-organic-chemistry/main/modules/m00067/index.cnxml)_
- [verified] OpenSMILES: for a tetrahedral center, starting from the preceding atom one 'looks' toward the chiral center; the remaining three neighbors are listed anticlockwise for '@' and clockwise for '@@' ('@'='@TH1', '@@'='@TH2'). An implicit hydrogen written inside the bracket 'is considered to be the first atom in the clockwise or anticlockwise accounting' (example N[C@H](O)C). For ring-closure bonds 'it is the order of the bonds to these atoms that should be considered' (FC1C[C@](Br)(Cl)CCC1 equals [C@]1(Br)(Cl)CCCC(F)C1). F/C=C/F and F\C=C\F are trans; F/C=C\F and F\C=C/F are cis; the up/down of each single bond is 'relative to the carbon atom, not the double bond'; C/C(\F)=C/F is invalid (both substituents 'down'); marking one substituent per end is sufficient. _(source: https://raw.githubusercontent.com/opensmiles/OpenSMILES/master/opensmiles.asciidoc)_
- [likely] IUPAC 2013 Recommendations P-92.1.4 (hierarchical digraphs): phantom atoms have atomic number zero; 'Only the doubly bonded atoms themselves are duplicated, and not the atoms or groups attached to them; the duplicated atoms may thus be considered as carrying three phantom atoms of atomic number zero.' _(source: Search-result excerpt of https://iupac.qmul.ac.uk/BlueBook/P9.html (full page blocked by egress proxy; wording seen only in the search snippet))_
- [verified] RDKit's 'new' CIP labeler implements the Hanson et al. 2018 algorithm ('a much more accurate algorithm' that 'does not provide CIP rankings of atoms'); the legacy labeler is Labute's approximation whose codes 'are only truly correct for simple examples'. RDKit treats implicit H 'as if they are the first neighbors after the central atom' and stores double-bond stereo from / and \ directional bonds. _(source: https://raw.githubusercontent.com/rdkit/rdkit/master/Docs/Book/RDKit_Book.rst)_
- [likely] Hanson, Mayfield, Vainio, Yerin, Redkin, Musacchio, 'Algorithmic Analysis of Cahn-Ingold-Prelog Rules of Stereochemistry: Proposals for Revised Rules and a Guide for Machine Implementation', J. Chem. Inf. Model. 2018, found deficiencies in Rules 1b and 2 and proposed a Rule 6; an accompanying CIP Validation Suite (github.com/CIPValidationSuite/ValidationSuite, v1.0 2018-05-20) encodes expected labels per atom (R,S,r,s,M,P,m,p,Z,E) with 1-based atom numbers in SMILES; the suite reportedly has ~300 compounds. _(source: https://raw.githubusercontent.com/CIPValidationSuite/ValidationSuite/master/README.md (read) plus search snippets for the paper (chemrxiv/ACS pages blocked))_
- [verified] RDKit 2026.03.6 (rdCIPLabeler) labels: C[C@@H](O)CC = (R)-2-butanol; C[C@@H](Br)CC = (R)-2-bromobutane; N[C@@H](C)C(=O)O (L-alanine) = S; C[C@H](O)C(=O)O (L-lactic) = S; O=C[C@H](O)CO = (R)-glyceraldehyde; C[C@H](Br)[C@H](Br)C = meso (2R,3S)-2,3-dibromobutane (self-mirror canonical SMILES) while C[C@@H](Br)[C@H](Br)C = (2R,3R); CCC[C@H](C)CC = (R)-3-methylhexane; OC(=O)[C@H](O)[C@H](O)C(=O)O = meso-tartaric; C/C=C/C = E, C/C=C\C = Z; C/C=C(/Cl)C = (E)-2-chloro-2-butene; CC=C(C)C has no E/Z. _(source: Local RDKit runs (scratchpad scripts conv.py, conv2.py, lib.py))_
- [verified] cis-1-bromo-2-methylcyclohexane is (1R,2S)/(1S,2R) and trans is (1R,2R)/(1S,2S): C[C@H]1CCCC[C@H]1Br (labels C(Me)=S, C(Br)=R) is cis by ring-normal face analysis of an MMFF-optimized chair, and the same result is obtained on the cube-chair grid layout; cis-1,2-dimethylcyclohexane C[C@H]1CCCC[C@H]1C is meso. _(source: Local RDKit runs (test2.py sections D and E))_
- [verified] Sign conventions verified numerically: with substituent tip positions a1..a4 in CIP priority order, V=((a2-a1)x(a3-a1))·(a4-a1) > 0 <=> R and < 0 <=> S (178/178 true chirality centers on ETKDG conformers agree with RDKit; cholesterol 8/8). For SMILES neighbor order (n1..n4), '@@' <=> V(n1,n2,n3,n4) > 0 and '@' <=> V < 0 (N[C@@H](C)C(=O)O gave V=+8.1, N[C@H](C)C(=O)O gave V=-8.1). _(source: Local RDKit runs (test1.py, test2.py section B))_
- [verified] On the octahedral direction set {±x,±y,±z}: of the 20 three-subsets, the 8 mutually-orthogonal ('octant') trios give the same handedness sign for every one of the three free positions (and for the virtual position -(v1+v2+v3)); the 12 trios containing an antiparallel pair ('T') give +, -, and 0 depending on the free position chosen, so implicit-H handedness is undefined. Of the 15 four-subsets, 12 ('seesaw') have nonzero signed volume and 3 (square planar, i.e. the two empty positions opposite each other) have zero. RDKit's own AssignStereochemistryFrom3D on the same grid coordinates gives identical results (S/R for octant and seesaw cases, no stereo for T and square-planar). _(source: Local exhaustive enumeration and RDKit cross-check (test3.py section B, test2.py section A))_
- [verified] A Rule-1a-only hierarchical digraph CIP implementation (duplicates for multiple bonds and ring closures, BFS sphere-by-sphere with children sorted by recursive rank) reproduces RDKit's labels on all tested true chirality centers including the hierarchical trap 3-pentyl vs 3-methylbutan-2-yl (RDKit and the reference both rank 3-methylbutan-2-yl higher); the only disagreements are pseudo-asymmetric centers (RDKit lowercase r/s in 1,4-disubstituted cyclohexanes and decalin ring-fusion carbons), which Rule 1a reports as ties. _(source: Local runs (test1.py: 178 centers, 8 mismatches all r/s; test3.py section A))_
- [likely] The cubic lattice is bipartite (color by parity of x+y+z), so any cycle built from face-adjacent bonds has even length; 3-, 5-, 7-membered rings are impossible without diagonal bonds. Six-membered rings on the lattice come in three shapes: the planar 3x2 rectangle (two vertices have collinear ring bonds), the skew 'chair' (Petrie hexagon of a cube; ring bonds orthogonal at every vertex; its mean-plane normal is a cube body diagonal) and the 'boat' (four vertices on one face, two on the opposite face; also all-orthogonal). _(source: Mathematical reasoning; the chair layout (0,0,0),(1,0,0),(1,1,0),(1,1,1),(0,1,1),(0,0,1) was used and its normal computed as (1,-1,1)/sqrt3 in test2.py section E)_
- [verified] Parity comparison under graph isomorphism correctly classifies grid-built molecules: S- vs R-2-butanol -> ENANTIOMER; (2R,3S) vs (2S,3R)-2,3-dibromobutane -> SAME (meso); (2R,3R) vs (2S,3S) -> ENANTIOMER; (2R,3R) vs meso -> DIASTEREOMER; cis- vs trans-1,4-dimethylcyclohexane (which have no CIP chirality centers) -> DIASTEREOMER, and cis built on either face -> SAME; a T-shaped (flat) center -> UNSPECIFIED. _(source: Local run test3c.py section C)_
- [verified] openstax.org, chem.libretexts.org, iupac.qmul.ac.uk, opensmiles.org, wikipedia, pubchem, cactus.nci.nih.gov, daylight.com, chemrxiv.org and europepmc.org are blocked by this session's egress proxy; raw.githubusercontent.com and github.com are reachable, which is how the OpenStax CNXML source, OpenSMILES asciidoc, RDKit book and CIP validation suite README were read. _(source: Tool errors in this session)_

## Recommendations

- Before finalizing the challenge content, have the orchestrator confirm the v1 topic list with the user: the relayed user message ('Wait, you didn't ask me what topics should be included') indicates the topic scope was not actually approved by the user.
- Implement stereo comparison as graph isomorphism + signed-volume parity (target neighbor order evaluated in student coordinates) + per-double-bond cis flag, and use CIP labels only for feedback text; this handles meso, 1,4-disubstituted rings and pseudo-asymmetric cases without needing CIP rules 3-5.
- Treat an implicit-H center whose three explicit substituents include an opposite pair (T shape) as UNSPECIFIED, never guess a position; give the two-way fix ('bend the chain here' or 'place H above/below'), and render two faint '?' H ghosts to show the ambiguity.
- Ship cyclohexane in the library and tutorial as the cube 'chair' hexagon (0,0,0),(1,0,0),(1,1,0),(1,1,1),(0,1,1),(0,0,1); it gives every ring carbon orthogonal ring bonds so ring stereocenters are assignable and up/down faces are unambiguous. Exempt ring double bonds (ring size <= 7) from E/Z and geometry flags.
- Keep E/Z strict (substituents perpendicular to the C=C axis, opposite each other, both ends coplanar) with explicit teaching messages; expose a config flag for the lenient collinear interpretation rather than defaulting to it.
- Port the tested Python reference (cipref.py) rather than writing a Morgan/iterative-refinement ranking: sibling ordering must use the full recursive comparison (hierarchical digraph) or cases like 3-methylbutan-2-yl vs 3-pentyl come out wrong.
- Generate the stereo target library with an automated check: parse SMILES -> compute labels with the engine -> compare with the RDKit-verified table in the spec (or regenerate with RDKit's rdCIPLabeler in a one-off script); never hand-author meso or ring SMILES by intuition.
- Add unit tests from the spec's tables: the 8/12 trio and 12/3 quad enumeration, the 2-butanol grid cases, the four 1-bromo-2-methylcyclohexane chair builds, the but-2-ene layouts, the SMILES convention cases ([C@H](F)(Cl)Br == F[C@@H](Cl)Br; C[C@H](Br)[C@H](Br)C is meso), and the L-alanine parity->S derivation.
- If time permits, download the CIP Validation Suite (github.com/CIPValidationSuite/ValidationSuite) and run the engine on its TH and CT entries that need only Rule 1a, reporting the rest as CANNOT_ASSIGN, to catch regressions.

## Risks

- The user has said they were not asked which topics to include; the whole v1 scope (and therefore the challenge set in this spec) may change once they are consulted.
- The proxy blocked openstax.org, LibreTexts, IUPAC, OpenSMILES, Wikipedia, PubChem and the paper hosts; McMurry text was read from OpenStax's GitHub CNXML source (authoritative, same content) and the OpenSMILES text from its GitHub source, but the IUPAC P-92 phantom-atom wording is only from a search snippet (marked 'likely').
- Rule 1a only: molecules where ligands differ only in stereochemistry (pseudo-asymmetric centers, e.g. C3 of 2,3,4-trihydroxypentane, or cis/trans-1,4-disubstituted rings) get no R/S label. The comparison engine still grades them correctly, but Q1/Q2-style label quizzes must exclude such molecules or the engine must say 'cannot assign'.
- Students will naturally build straight-chain alkenes and T-shaped stereocenters; both are rejected/unspecified by design. Expect early friction; the tutorial must teach 'bend at sp3 centers, zigzag at C=C' before stereo challenges are unlocked.
- Explicit-H placement in the ring-plane (square planar) or on a T trio is a dead end the student may not understand; the ghost-H rendering and messages in the spec mitigate but were not user-tested.
- Aromatic rings are Kekulé structures in the builder; CIP ranking through phenyl rings is fine for the library above, but exotic substituted aromatics could rank differently between the two Kekulé forms (IUPAC uses averaged duplicates). Keep aromatics out of stereo challenges or verify each library entry.
- Directional bonds on ring-closure digits and stereo double bonds inside rings are not parsed; the library validator must reject such SMILES so they never reach the parser.
- Isomorphism enumeration is brute-force-safe only because molecules are <= 30 heavy atoms; a naive permutation enumerator (as in the test script) is NOT acceptable in the game - use VF2-style backtracking with element/degree/H-count/bond-order pruning.
- RDKit was used as the oracle; it is the de-facto reference (Hanson 2018 algorithm) but the labels in the target table were not independently checked against a printed McMurry answer key beyond the cases the OpenStax text states (lactic acid, alanine, glyceraldehyde, tartaric, threonine, 2-chloro-2-butene example).
