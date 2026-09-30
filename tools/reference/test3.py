import cipref as C, itertools
import numpy as np
from rdkit import Chem
from rdkit.Chem import AllChem, rdCIPLabeler
from rdkit import RDLogger; RDLogger.DisableLog('rdApp.*')

print("=== A. hierarchical trap: 3-pentyl vs 3-methylbutan-2-yl ===")
for s in ['O[C@H](C(CC)CC)C(C)C(C)C', 'O[C@@H](C(CC)CC)C(C)C(C)C']:
    m = Chem.MolFromSmiles(s); rdCIPLabeler.AssignCIPLabels(m)
    exp = m.GetAtomWithIdx(1).GetProp('_CIPCode')
    mh = Chem.AddHs(m); AllChem.EmbedMolecule(mh, randomSeed=2); conf = mh.GetConformer()
    atoms = [(a.GetAtomicNum(), a.GetTotalNumHs()) for a in m.GetAtoms()]
    bonds = {(b.GetBeginAtomIdx(), b.GetEndAtomIdx()): int(b.GetBondTypeAsDouble()) for b in m.GetBonds()}
    pos = [tuple(conf.GetAtomPosition(i)) for i in range(m.GetNumAtoms())]
    C._cache.clear(); mol = C.Mol(atoms, bonds, pos)
    lab, order = C.assign_center(mol, 1)
    print(s, 'rdkit', exp, 'mine', lab, 'priority order atoms', order, '(2=3-pentyl C, 6=3-methylbutan-2-yl C)')

print("\n=== B. exhaustive octahedral enumeration ===")
D = [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]
ok_trios = {'octant':0,'T':0}; bad=0
for trio in itertools.combinations(D, 3):
    free = [d for d in D if d not in trio]
    signs = set()
    for h in free:
        n = C.cross(C.sub(trio[1],trio[0]), C.sub(trio[2],trio[0])); v = C.dot(n, C.sub(h, trio[0]))
        signs.add(0 if v == 0 else (1 if v>0 else -1))
    orth = all(C.dot(a,b)==0 for a,b in itertools.combinations(trio,2))
    virt = C.chirality_from_vectors([trio[0],trio[1],trio[2],None])
    if orth:
        assert signs in ({1},{-1}) and virt != 'PLANAR', (trio, signs); ok_trios['octant']+=1
    else:
        assert 0 in signs and len(signs)==3 and virt == 'PLANAR', (trio, signs); ok_trios['T']+=1
print('trios:', ok_trios, '(octant => all 3 free positions give same sign and virtual -(v1+v2+v3) agrees; T => positions give +,-,0)')
quads = {'nonplanar':0,'planar':0}
for q in itertools.combinations(D, 4):
    lab = C.chirality_from_vectors(list(q))
    missing = [d for d in D if d not in q]
    antipar = C.dot(missing[0], missing[1]) == -1
    if lab == 'PLANAR': assert antipar; quads['planar']+=1
    else: assert not antipar; quads['nonplanar']+=1
print('quads:', quads, '(planar exactly when the two empty positions are opposite each other)')

print("\n=== C. parity comparison under isomorphism ===")
def parity_grid(mol, a):
    """parity of atom a w.r.t. its neighbor list order [n1..n4] (implicit H last, placed at -(sum)); returns (nbr_tuple, sign)"""
    nb = sorted(mol.adj[a]); c = mol.pos[a]
    vs = [C.sub(mol.pos[j], c) for j in nb]
    if mol.hcount[a] == 1: vs.append(C.neg(C.add(C.add(vs[0], vs[1]), vs[2]))); nb = nb + ['H']
    if len(vs) != 4: return None
    n = C.cross(C.sub(vs[1],vs[0]), C.sub(vs[2],vs[0])); v = C.dot(n, C.sub(vs[3],vs[0]))
    return (tuple(nb), 0 if abs(v)<1e-9 else (1 if v>0 else -1))
def perm_sign(seq_from, seq_to):
    idx = [seq_from.index(x) for x in seq_to]; s = 1
    for i in range(len(idx)):
        for j in range(i+1, len(idx)):
            if idx[i] > idx[j]: s = -s
    return s
def isomorphisms(A, B):
    """brute force: all bijections A->B preserving Z, hcount, bonds (fine for tiny test molecules)"""
    n = len(A.Z); 
    if n != len(B.Z): return
    for p in itertools.permutations(range(n)):
        if all(A.Z[i]==B.Z[p[i]] and A.hcount[i]==B.hcount[p[i]] for i in range(n)) and \
           all(frozenset((p[i],p[j])) in B.bonds and B.bonds[frozenset((p[i],p[j]))]==o for (i,j),o in [(tuple(k),o) for k,o in A.bonds.items()]):
            yield p
def stereo_compare(T, S):
    """T target, S student (both with pos). returns 'SAME' | 'ENANTIOMER' | 'DIASTEREOMER' | 'UNSPECIFIED' | 'DIFFERENT_CONSTITUTION'"""
    best = None; found=False
    for p in isomorphisms(T, S):
        found=True; matches=[]; 
        for a in range(len(T.Z)):
            pt = parity_grid(T, a)
            if pt is None: continue
            nbT, sT = pt
            ps = parity_grid(S, p[a]); nbS, sS = ps
            mapped = tuple(p[x] if x!='H' else 'H' for x in nbT)   # T's neighbor order mapped into S
            sS_in_T_order = sS * perm_sign(list(nbS), list(mapped))
            if sT == 0 or sS == 0: matches.append(None)
            else: matches.append(sT == sS_in_T_order)
        if None in matches: return 'UNSPECIFIED'
        if all(matches): return 'SAME'
        if not any(matches): best = 'ENANTIOMER'
        elif best is None: best = 'DIASTEREOMER'
    return best if found else 'DIFFERENT_CONSTITUTION'
def M(atoms, bonds, pos): return C.Mol(atoms, bonds, pos)
# 2-butanol targets on grid (from test2: 'octant Me -x, O +z, Et +y' is S; O -z is R)
A2 = [(6,3),(6,1),(8,1),(6,2),(6,3)]; B2 = {(0,1):1,(1,2):1,(1,3):1,(3,4):1}
S_but = M(A2,B2,[(-1,0,0),(0,0,0),(0,0,1),(0,1,0),(0,2,0)]); R_but = M(A2,B2,[(-1,0,0),(0,0,0),(0,0,-1),(0,1,0),(0,2,0)])
R_but2 = M(A2,B2,[(0,0,0),(1,0,0),(1,1,0),(1,0,-1),(1,0,-2)])   # R built differently? check label
C._cache.clear(); print('R_but2 label:', C.assign_center(R_but2,1)[0])
flat = M(A2,B2,[(-1,0,0),(0,0,0),(0,1,0),(1,0,0),(2,0,0)])
print('S vs S(same build):', stereo_compare(S_but, S_but), '| S vs R:', stereo_compare(S_but, R_but), '| R vs R2 (different placement):', stereo_compare(R_but, R_but2), '| S vs flat:', stereo_compare(S_but, flat))
# 2,3-dibromobutane: atoms 0=C1 1=C2 2=Br 3=C3 4=Br 5=C4 ; C2 at origin, C3 at +x
A3 = [(6,3),(6,1),(35,0),(6,1),(35,0),(6,3)]; B3 = {(0,1):1,(1,2):1,(1,3):1,(3,4):1,(3,5):1}
def dbb(br2, br3, c1=(0,-1,0), c4=(1,1,0)): return M(A3,B3,[c1,(0,0,0),br2,(1,0,0),br3,c4])
meso_a = dbb((0,0,1),(1,0,1)); meso_b = dbb((0,0,-1),(1,0,-1)); chiral_a = dbb((0,0,1),(1,0,-1)); chiral_b = dbb((0,0,-1),(1,0,1))
for nm, mm in [('meso_a',meso_a),('meso_b',meso_b),('chiral_a',chiral_a),('chiral_b',chiral_b)]:
    C._cache.clear(); print(nm, 'labels C2,C3 =', C.assign_center(mm,1)[0], C.assign_center(mm,3)[0])
print('meso_a vs meso_b:', stereo_compare(meso_a, meso_b), '| chiral_a vs chiral_b:', stereo_compare(chiral_a, chiral_b), '| meso_a vs chiral_a:', stereo_compare(meso_a, chiral_a))
# 1,4-dimethylcyclohexane on cube chair (no CIP centers): cis vs trans
ring = [(0,0,0),(1,0,0),(1,1,0),(1,1,1),(0,1,1),(0,0,1)]
nrm = np.array([1,-1,1])/np.sqrt(3)
def perp_up(k, up):
    p = np.array(ring[k]); nb = [np.array(ring[(k+1)%6])-p, np.array(ring[(k-1)%6])-p]
    for d in [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]:
        if all(np.dot(d,b)==0 for b in nb) and (np.dot(d,nrm)>0) == up: return tuple(int(x) for x in p+np.array(d))
def dmch(up1, up4):
    atoms = [(6,1),(6,2),(6,2),(6,1),(6,2),(6,2),(6,3),(6,3)]; bonds = {(k,(k+1)%6):1 for k in range(6)}; bonds[(0,6)]=1; bonds[(3,7)]=1
    return M(atoms,bonds, ring + [perp_up(0,up1), perp_up(3,up4)])
cis1, cis2, tr1, tr2 = dmch(1,1), dmch(0,0), dmch(1,0), dmch(0,1)
C._cache.clear(); print('1,4-dimethylcyclohexane CIP center check (expect NOT_CENTER):', C.assign_center(cis1,0)[0])
print('cis vs cis(flipped):', stereo_compare(cis1, cis2), '| trans vs trans:', stereo_compare(tr1, tr2), '| cis vs trans:', stereo_compare(cis1, tr1))
