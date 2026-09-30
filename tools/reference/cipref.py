"""Reference implementation (portable to TypeScript) of:
  - CIP ranking by Rule 1a (atomic number) over the hierarchical digraph
    (duplicate atoms for multiple bonds and ring closures, phantom atoms Z=0),
    breadth-first sphere-by-sphere comparison with branches ordered hierarchically.
  - R/S from 3D/grid direction vectors via signed volume (implicit H handled).
  - E/Z from grid vectors.
Molecule model: atoms: list of (Z, implicitH); bonds: dict frozenset({i,j}) -> order (1,2,3).
"""
from functools import cmp_to_key
import itertools, math

class Mol:
    def __init__(self, atoms, bonds, pos=None):
        self.Z = [a[0] for a in atoms]
        self.hcount = [a[1] for a in atoms]
        self.bonds = {}
        self.adj = {i: [] for i in range(len(atoms))}
        for (i, j), o in bonds.items():
            self.bonds[frozenset((i, j))] = o
            self.adj[i].append(j); self.adj[j].append(i)
        self.pos = pos  # list of (x,y,z) or None

    def order(self, i, j): return self.bonds[frozenset((i, j))]

# ---------- hierarchical digraph nodes ----------
class Node:
    __slots__ = ('atom', 'parent', 'dup', 'path', 'Z')
    def __init__(self, mol, atom, parent, dup):
        self.atom = atom; self.parent = parent; self.dup = dup
        self.Z = 1 if atom == -1 else mol.Z[atom]          # atom == -1 => implicit H node
        self.path = (parent.path if parent else ()) + ((atom, dup),)

def children(mol, node):
    """Substituents of a node in the digraph, excluding the bond back to the parent
    (but including duplicate atoms that represent multiple bonds, ring closures)."""
    if node.dup or node.atom == -1:
        return []                          # duplicate atoms & H carry only phantoms (Z=0)
    i = node.atom
    ancestors = {a for (a, d) in node.path if not d}   # real atoms on the path root..node
    kids = []
    for j in mol.adj[i]:
        o = mol.order(i, j)
        if node.parent is not None and j == node.parent.atom and not node.parent.dup:
            # bond back to parent: only the multiplicity duplicates are children
            kids += [Node(mol, j, node, True) for _ in range(o - 1)]
            continue
        if j in ancestors:                 # ring closure: represent as duplicate
            kids.append(Node(mol, j, node, True))
        else:
            kids.append(Node(mol, j, node, False))
        kids += [Node(mol, j, node, True) for _ in range(o - 1)]   # multiple-bond duplicates
    kids += [Node(mol, -1, node, False) for _ in range(mol.hcount[i])]   # implicit H
    return kids

_cache = {}
def compare(mol, a, b):
    """Rule 1a hierarchical comparison of two ligand nodes. Returns +1 if a ranks higher,
    -1 if b ranks higher, 0 if indistinguishable by Rule 1a (constitutionally identical)."""
    key = (id(mol), a.path, b.path)
    if key in _cache: return _cache[key]
    la, lb = [a], [b]
    result = 0
    while True:
        # (1) compare atomic numbers at this sphere, in hierarchical order, padded with phantoms
        n = max(len(la), len(lb))
        for k in range(n):
            za = la[k].Z if k < len(la) else 0
            zb = lb[k].Z if k < len(lb) else 0
            if za != zb:
                result = 1 if za > zb else -1
                break
        if result: break
        # (2) build next sphere: each node's children sorted by full (recursive) rank
        ca = [sorted(children(mol, x), key=cmp_to_key(lambda p, q: -compare(mol, p, q))) for x in la]
        cb = [sorted(children(mol, x), key=cmp_to_key(lambda p, q: -compare(mol, p, q))) for x in lb]
        # (3) compare per parent-node child sets (sets aligned by parent's hierarchical position)
        for sa, sb in zip(ca, cb):
            m = max(len(sa), len(sb))
            for k in range(m):
                za = sa[k].Z if k < len(sa) else 0
                zb = sb[k].Z if k < len(sb) else 0
                if za != zb:
                    result = 1 if za > zb else -1
                    break
            if result: break
        if result: break
        la = [x for s in ca for x in s]; lb = [x for s in cb for x in s]
        if not la and not lb:
            result = 0; break
        if len(la) > 200 or len(lb) > 200:   # safety cap for pathological graphs
            result = 0; break
    _cache[key] = result
    return result

def rank_ligands(mol, center):
    """Returns list of (neighbor atom index or -1 for implicit H, rank 1..n) sorted best first,
    plus a flag 'tie' if two ligands are Rule-1a indistinguishable."""
    root = Node(mol, center, None, False)
    ligs = children(mol, root)
    ligs.sort(key=cmp_to_key(lambda p, q: -compare(mol, p, q)))
    tie = any(compare(mol, ligs[i], ligs[i + 1]) == 0 for i in range(len(ligs) - 1))
    return ligs, tie

# ---------- geometry ----------
def sub(a, b): return (a[0]-b[0], a[1]-b[1], a[2]-b[2])
def add(a, b): return (a[0]+b[0], a[1]+b[1], a[2]+b[2])
def neg(a): return (-a[0], -a[1], -a[2])
def dot(a, b): return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
def cross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])

def chirality_from_vectors(v, eps=1e-6):
    """v = [v1, v2, v3, v4] direction vectors (from center) in CIP priority order 1..4.
    v4 may be None (implicit H / unknown position): it is then placed at -(v1+v2+v3).
    Returns 'R', 'S' or 'PLANAR'."""
    v1, v2, v3, v4 = v
    if v4 is None:
        v4 = neg(add(add(v1, v2), v3))
    n = cross(sub(v2, v1), sub(v3, v1))          # normal of the plane through tips 1,2,3
    vol = dot(n, sub(v4, v1))                    # signed volume of tetrahedron (1,2,3,4)
    if abs(vol) < eps: return 'PLANAR'
    return 'R' if vol > 0 else 'S'

def assign_center(mol, center):
    """Full pipeline for one sp3 center: returns (label, info)."""
    ligs, tie = rank_ligands(mol, center)
    if len(ligs) != 4: return ('NOT_CENTER', 'needs 4 ligands')
    if tie: return ('NOT_CENTER', 'two identical ligands (Rule 1a tie)')
    c = mol.pos[center]
    vecs = []
    nH_implicit = 0
    for nd in ligs:
        if nd.atom == -1: vecs.append(None); nH_implicit += 1
        else: vecs.append(sub(mol.pos[nd.atom], c))
    if nH_implicit > 1: return ('NOT_CENTER', 'two H')
    if nH_implicit == 1 and vecs[3] is not None: return ('ERROR', 'implicit H not lowest?')
    # For implicit H on the octahedral grid: well-defined iff explicit trio mutually orthogonal.
    lab = chirality_from_vectors(vecs)
    if lab == 'PLANAR':
        return ('UNSPECIFIED', 'planar: ' + ('T-shaped trio with implicit H' if nH_implicit else 'square-planar / coplanar 4'))
    return (lab, [nd.atom for nd in ligs])

def ez_from_grid(mol, ca, cb):
    """E/Z for double bond ca=cb using grid vectors. Returns (label, info)."""
    u = sub(mol.pos[cb], mol.pos[ca])
    def end(c, other):
        root = Node(mol, c, None, False)
        ligs = [n for n in children(mol, root) if not (n.atom == other)]
        ligs.sort(key=cmp_to_key(lambda p, q: -compare(mol, p, q)))
        if len(ligs) != 2: return None, 'alkene carbon must have exactly two other ligands'
        if compare(mol, ligs[0], ligs[1]) == 0: return None, 'NO_EZ: two identical substituents on C%d' % c
        vs = []
        for n in ligs:
            vs.append(None if n.atom == -1 else sub(mol.pos[n.atom], mol.pos[c]))
        expl = [x for x in vs if x is not None]
        for x in expl:
            if dot(x, u) != 0: return None, 'COLLINEAR: substituent on C%d lies along the C=C axis' % c
        if len(expl) == 2 and dot(expl[0], expl[1]) != -dot(expl[0], expl[0]):
            return None, 'NOT_PLANAR: substituents on C%d are not opposite each other (90 deg apart)' % c
        if len(expl) == 0: return None, 'NO_EZ: two implicit H on C%d' % c
        # fill implicit H position = opposite of explicit one
        if vs[0] is None: vs[0] = neg(vs[1])
        if vs[1] is None: vs[1] = neg(vs[0])
        return (ligs, vs), None
    ra, ea = end(ca, cb)
    if ea: return (None, ea)
    rb, eb = end(cb, ca)
    if eb: return (None, eb)
    pa = ra[1][0]; pb = rb[1][0]      # higher-priority substituent vectors
    d = dot(pa, pb)
    if d == 0: return (None, 'TWISTED: the two ends are in perpendicular planes')
    return ('Z' if d > 0 else 'E', None)
