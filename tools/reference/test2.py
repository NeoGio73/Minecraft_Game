import cipref as C, time
from rdkit import Chem
from rdkit.Chem import AllChem, rdCIPLabeler
from rdkit.Geometry import Point3D
from rdkit import RDLogger; RDLogger.DisableLog('rdApp.*')
import numpy as np

def rd_from_grid(atoms, bonds, pos):
    """Build RDKit mol from my model with a conformer at grid coords*1.5 A, let RDKit perceive stereo from 3D."""
    rw = Chem.RWMol()
    for Z, h in atoms:
        a = Chem.Atom(Z); a.SetNumExplicitHs(h); a.SetNoImplicit(True); rw.AddAtom(a)
    bt = {1: Chem.BondType.SINGLE, 2: Chem.BondType.DOUBLE, 3: Chem.BondType.TRIPLE}
    for (i, j), o in bonds.items(): rw.AddBond(i, j, bt[o])
    m = rw.GetMol(); Chem.SanitizeMol(m)
    conf = Chem.Conformer(m.GetNumAtoms())
    for i, p in enumerate(pos): conf.SetAtomPosition(i, Point3D(*[1.5 * x for x in p]))
    m.AddConformer(conf, assignId=True)
    Chem.AssignStereochemistryFrom3D(m)
    rdCIPLabeler.AssignCIPLabels(m)
    at = {a.GetIdx(): a.GetProp('_CIPCode') for a in m.GetAtoms() if a.HasProp('_CIPCode')}
    bd = {(b.GetBeginAtomIdx(), b.GetEndAtomIdx()): b.GetProp('_CIPCode') for b in m.GetBonds() if b.HasProp('_CIPCode')}
    return at, bd, Chem.MolToSmiles(m)

print("=== A. 2-butanol on the octahedral grid: C2 at origin. atoms: 0=C1(Me) 1=C2 2=O 3=C3 4=C4 (+optional H) ===")
cases = {
 'octant: Me -x, O +z, Et +y (H implicit)': ([(6,3),(6,1),(8,1),(6,2),(6,3)], {(0,1):1,(1,2):1,(1,3):1,(3,4):1}, [(-1,0,0),(0,0,0),(0,0,1),(0,1,0),(0,2,0)]),
 'octant mirror: Me -x, O -z, Et +y': ([(6,3),(6,1),(8,1),(6,2),(6,3)], {(0,1):1,(1,2):1,(1,3):1,(3,4):1}, [(-1,0,0),(0,0,0),(0,0,-1),(0,1,0),(0,2,0)]),
 'T-shape: Me -x, Et +x, O +y (H implicit) -> ambiguous': ([(6,3),(6,1),(8,1),(6,2),(6,3)], {(0,1):1,(1,2):1,(1,3):1,(3,4):1}, [(-1,0,0),(0,0,0),(0,1,0),(1,0,0),(2,0,0)]),
 'T-shape + explicit H +z (seesaw)': ([(6,3),(6,0),(8,1),(6,2),(6,3),(1,0)], {(0,1):1,(1,2):1,(1,3):1,(3,4):1,(1,5):1}, [(-1,0,0),(0,0,0),(0,1,0),(1,0,0),(2,0,0),(0,0,1)]),
 'T-shape + explicit H -z (seesaw, mirror)': ([(6,3),(6,0),(8,1),(6,2),(6,3),(1,0)], {(0,1):1,(1,2):1,(1,3):1,(3,4):1,(1,5):1}, [(-1,0,0),(0,0,0),(0,1,0),(1,0,0),(2,0,0),(0,0,-1)]),
 'square planar: Me -x, Et +x, O +y, H -y': ([(6,3),(6,0),(8,1),(6,2),(6,3),(1,0)], {(0,1):1,(1,2):1,(1,3):1,(3,4):1,(1,5):1}, [(-1,0,0),(0,0,0),(0,1,0),(1,0,0),(2,0,0),(0,-1,0)]),
 'octant + explicit H at -x (4 explicit, seesaw)': ([(6,3),(6,0),(8,1),(6,2),(6,3),(1,0)], {(0,1):1,(1,2):1,(1,3):1,(3,4):1,(1,5):1}, [(1,0,0),(0,0,0),(0,0,1),(0,1,0),(0,2,0),(-1,0,0)]),
 'octant + explicit H at -y (should equal previous)': ([(6,3),(6,0),(8,1),(6,2),(6,3),(1,0)], {(0,1):1,(1,2):1,(1,3):1,(3,4):1,(1,5):1}, [(1,0,0),(0,0,0),(0,0,1),(0,1,0),(0,2,0),(0,-1,0)]),
 'octant + explicit H at -z (should equal previous)': ([(6,3),(6,0),(8,1),(6,2),(6,3),(1,0)], {(0,1):1,(1,2):1,(1,3):1,(3,4):1,(1,5):1}, [(1,0,0),(0,0,0),(0,0,1),(0,1,0),(0,2,0),(0,0,-1)]),
}
for name, (atoms, bonds, pos) in cases.items():
    C._cache.clear()
    mol = C.Mol(atoms, bonds, pos)
    mine = C.assign_center(mol, 1)
    at, bd, smi = rd_from_grid(atoms, bonds, pos)
    print(f"{name:52s} mine={mine[0]:12s} rdkit={at.get(1,'-'):3s} {smi}")

print("\n=== B. sign convention: '@' vs signed volume V(n1,n2,n3,n4) ===")
m = Chem.AddHs(Chem.MolFromSmiles('N[C@@H](C)C(=O)O'))  # S-alanine; neighbor order N, H, C(methyl), C(carboxyl); tag @@
AllChem.EmbedMolecule(m, randomSeed=1); conf = m.GetConformer()
c = m.GetAtomWithIdx(1)
nbrs = [n.GetIdx() for n in c.GetNeighbors()]
order = [0] + [i for i in nbrs if m.GetAtomWithIdx(i).GetAtomicNum() == 1] + [2, 3]
P = lambda i: np.array(list(conf.GetAtomPosition(i)))
n1, n2, n3, n4 = [P(i) for i in order]
V = np.dot(np.cross(n2 - n1, n3 - n1), n4 - n1)
print("N[C@@H](C)C(=O)O neighbor order (N,H,CH3,COOH) tag=@@ : V =", round(V, 3), "-> '@@' <=> V", ">0" if V > 0 else "<0")
m2 = Chem.AddHs(Chem.MolFromSmiles('N[C@H](C)C(=O)O'))
AllChem.EmbedMolecule(m2, randomSeed=1); conf = m2.GetConformer()
n1, n2, n3, n4 = [P(i) for i in order]
V2 = np.dot(np.cross(n2 - n1, n3 - n1), n4 - n1)
print("N[C@H](C)C(=O)O  tag=@  : V =", round(V2, 3))

print("\n=== C. E/Z on grid: but-2-ene, atoms 0=C1 1=C2 2=C3 3=C4 ===")
ez = {
 'zigzag E: C1 +y of C2, C4 -y of C3': [(0,1,0),(0,0,0),(1,0,0),(1,-1,0)],
 'zigzag Z: C1 +y, C4 +y': [(0,1,0),(0,0,0),(1,0,0),(1,1,0)],
 'twisted: C1 +y, C4 +z': [(0,1,0),(0,0,0),(1,0,0),(1,0,1)],
 'straight line (collinear)': [(-1,0,0),(0,0,0),(1,0,0),(2,0,0)],
 'E in xz plane: C1 +z, C4 -z': [(0,0,1),(0,0,0),(1,0,0),(1,0,-1)],
}
for name, pos in ez.items():
    atoms = [(6,3),(6,1),(6,1),(6,3)]; bonds = {(0,1):1,(1,2):2,(2,3):1}
    C._cache.clear(); mol = C.Mol(atoms, bonds, pos)
    mine = C.ez_from_grid(mol, 1, 2)
    at, bd, smi = rd_from_grid(atoms, bonds, pos)
    print(f"{name:40s} mine={str(mine):70s} rdkit={bd.get((1,2),'-')} {smi}")
# 2-methylbut-2-ene: no E/Z
atoms = [(6,3),(6,1),(6,0),(6,3),(6,3)]; bonds = {(0,1):1,(1,2):2,(2,3):1,(2,4):1}; pos=[(0,1,0),(0,0,0),(1,0,0),(1,1,0),(1,-1,0)]
C._cache.clear(); print('2-methylbut-2-ene:', C.ez_from_grid(C.Mol(atoms,bonds,pos),1,2))
# explicit H on alkene carbon at 90 deg (not planar)
atoms = [(6,3),(6,0),(6,1),(6,3),(1,0)]; bonds = {(0,1):1,(1,2):2,(2,3):1,(1,4):1}; pos=[(0,1,0),(0,0,0),(1,0,0),(1,-1,0),(0,0,1)]
C._cache.clear(); print('explicit H at 90deg to Me on C2:', C.ez_from_grid(C.Mol(atoms,bonds,pos),1,2))

print("\n=== D. cis/trans faces from ring normal on ETKDG conformers; which SMILES is cis-1-bromo-2-methylcyclohexane? ===")
def faces(smi, ring_atoms, subs):
    m = Chem.AddHs(Chem.MolFromSmiles(smi)); AllChem.EmbedMolecule(m, randomSeed=3); AllChem.MMFFOptimizeMolecule(m)
    conf = m.GetConformer(); P = lambda i: np.array(list(conf.GetAtomPosition(i)))
    ring = [P(i) for i in ring_atoms]; cen = sum(ring)/len(ring)
    n = sum(np.cross(ring[k]-cen, ring[(k+1)%len(ring)]-cen) for k in range(len(ring)))  # Newell-style normal
    n /= np.linalg.norm(n)
    out = []
    for ra, s in subs: out.append(float(np.dot(P(s)-P(ra), n)))
    return out
for smi in ['C[C@H]1CCCC[C@H]1Br','C[C@H]1CCCC[C@@H]1Br']:
    mm = Chem.MolFromSmiles(smi); rdCIPLabeler.AssignCIPLabels(mm)
    labs = {a.GetIdx(): a.GetProp('_CIPCode') for a in mm.GetAtoms() if a.HasProp('_CIPCode')}
    f = faces(smi, [1,2,3,4,5,6], [(1,0),(6,7)])
    print(smi, 'labels', labs, 'face dots (Me, Br) =', [round(x,2) for x in f], '=>', 'cis' if f[0]*f[1] > 0 else 'trans')
for smi in ['C[C@H]1CCCC[C@H]1C','C[C@H]1CCCC[C@@H]1C']:
    f = faces(smi, [1,2,3,4,5,6], [(1,0),(6,7)])
    print(smi, '1,2-dimethyl face dots', [round(x,2) for x in f], '=>', 'cis' if f[0]*f[1] > 0 else 'trans')

print("\n=== E. cube-chair (Petrie hexagon) cyclohexane on grid; 1-bromo-2-methyl ===")
ring = [(0,0,0),(1,0,0),(1,1,0),(1,1,1),(0,1,1),(0,0,1)]
# ring atom k bonds: k->(k+1)%6. substituent 'up' = +normal direction. normal ~ (1,1,1) or (-1,-1,-1); compute:
cen = np.mean(ring, axis=0); nrm = sum(np.cross(np.array(ring[k])-cen, np.array(ring[(k+1)%6])-cen) for k in range(6)); nrm = nrm/np.linalg.norm(nrm)
print('ring normal =', np.round(nrm,3))
def free_perp(k):
    p = np.array(ring[k]); nb = [np.array(ring[(k+1)%6])-p, np.array(ring[(k-1)%6])-p]
    return [d for d in [np.array(v) for v in [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]] if all(np.dot(d,b)==0 for b in nb)]
for k in range(6): print('atom',k,'perp free dirs', [tuple(int(x) for x in d) for d in free_perp(k)], 'up one:', [tuple(int(x) for x in d) for d in free_perp(k) if np.dot(d,nrm)>0])
def build(br_up, me_up):
    atoms = [(6,1),(6,1)] + [(6,2)]*4 + [(35,0),(6,3)]
    bonds = {(k,(k+1)%6):1 for k in range(6)}; bonds[(0,6)] = 1; bonds[(1,7)] = 1
    up0 = [d for d in free_perp(0) if np.dot(d,nrm)>0][0]; up1 = [d for d in free_perp(1) if np.dot(d,nrm)>0][0]
    pos = list(ring) + [tuple(int(x) for x in (np.array(ring[0]) + (up0 if br_up else -up0))), tuple(int(x) for x in (np.array(ring[1]) + (up1 if me_up else -up1)))]
    return atoms, bonds, pos
for br_up, me_up, name in [(1,1,'cis (both up)'),(1,0,'trans (Br up, Me down)'),(0,0,'cis (both down)'),(0,1,'trans (Br down, Me up)')]:
    atoms, bonds, pos = build(br_up, me_up); C._cache.clear(); mol = C.Mol(atoms, bonds, pos)
    l0 = C.assign_center(mol, 0); l1 = C.assign_center(mol, 1)
    at, bd, smi = rd_from_grid(atoms, bonds, pos)
    print(f"{name:26s} mine: C1(Br)={l0[0]} C2(Me)={l1[0]}   rdkit: {at}  {smi}")

print("\n=== F. timing on ~27 heavy atoms (cholesterol) ===")
m = Chem.MolFromSmiles('C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C')
exp = {a.GetIdx(): a.GetProp('_CIPCode') for a in (rdCIPLabeler.AssignCIPLabels(m) or m).GetAtoms() if a.HasProp('_CIPCode')}
mh = Chem.AddHs(m); AllChem.EmbedMolecule(mh, randomSeed=5); conf = mh.GetConformer()
atoms = [(a.GetAtomicNum(), a.GetTotalNumHs()) for a in m.GetAtoms()]
bonds = {(b.GetBeginAtomIdx(), b.GetEndAtomIdx()): int(b.GetBondTypeAsDouble()) for b in m.GetBonds()}
pos = [tuple(conf.GetAtomPosition(i)) for i in range(m.GetNumAtoms())]
C._cache.clear(); t = time.time(); mol = C.Mol(atoms, bonds, pos)
got = {i: C.assign_center(mol, i)[0] for i in range(m.GetNumAtoms()) if m.GetAtomWithIdx(i).GetAtomicNum()==6 and m.GetAtomWithIdx(i).GetDegree()+m.GetAtomWithIdx(i).GetTotalNumHs()==4}
print('time %.2fs' % (time.time()-t), 'mismatches:', {i:(exp.get(i,'-'),got[i]) for i in got if got[i] in ('R','S') or i in exp if got[i] != exp.get(i,'-')})
