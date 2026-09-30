import cipref as C
from rdkit import Chem
from rdkit.Chem import AllChem, rdCIPLabeler
from rdkit import RDLogger; RDLogger.DisableLog('rdApp.*')

def rd_labels(m):
    rdCIPLabeler.AssignCIPLabels(m)
    at = {a.GetIdx(): a.GetProp('_CIPCode') for a in m.GetAtoms() if a.HasProp('_CIPCode')}
    bd = {(b.GetBeginAtomIdx(), b.GetEndAtomIdx()): b.GetProp('_CIPCode') for b in m.GetBonds() if b.HasProp('_CIPCode')}
    return at, bd

def to_mol(m, conf=None):
    atoms = [(a.GetAtomicNum(), a.GetTotalNumHs()) for a in m.GetAtoms()]
    bonds = {(b.GetBeginAtomIdx(), b.GetEndAtomIdx()): int(b.GetBondTypeAsDouble()) for b in m.GetBonds()}
    pos = None
    if conf is not None:
        pos = [tuple(conf.GetAtomPosition(i)) for i in range(m.GetNumAtoms())]
    return C.Mol(atoms, bonds, pos)

smiles = ['C[C@H](O)CC','C[C@@H](O)CC','C[C@H](Br)CC','N[C@@H](C)C(=O)O','C[C@H](O)C(=O)O','C[C@H](Br)[C@H](Br)C','C[C@H](Br)[C@@H](Br)C',
 'CCC[C@H](C)CC','O=C[C@H](O)CO','C=C[C@H](C)O','C#C[C@H](O)C(C)(C)C','C=C[C@H](O)C(C)C','C[C@H]1CCCC[C@H]1Br','C[C@H]1CCCC[C@@H]1Br',
 'OC(=O)[C@H](O)[C@H](O)C(=O)O','C[C@@H](O)[C@H](N)C(=O)O','C[C@H]1CCCCC1=O','C[C@H]1C=CCCC1','F[C@H](Cl)Br','C[C@H](N)C(=O)OC',
 'OC[C@H](O)[C@@H](O)[C@H](O)[C@H](O)C=O', 'C[C@]12CC[C@H](C1)C(C)(C)C2=O', 'CC(C)[C@@H](C(=O)O)N', 'C[C@H](c1ccccc1)N', 'CC[C@H](C)C(=O)O',
 'C[C@H](CC)Cc1ccccc1', 'C1CC[C@H]2CCCC[C@@H]2C1', 'C1CC[C@H]2CCCC[C@H]2C1', 'CC(=O)O[C@H](C)C(=O)O', 'N[C@@H](CS)C(=O)O',
 'Cl[C@H](Br)C(C)(C)C', 'C[C@@H](/C=C/C)O', 'C[C@@H](C=C)C#C', 'C[C@H](O)C(=O)C', 'O[C@@H]1CCCC[C@H]1O','CC[C@H](CO)C(C)C',
 'C[C@@H]1CC[C@H](C(C)C)CC1', 'C[C@@H]1CC[C@@H](C(C)C)CC1']
bad = 0; total = 0
for s in smiles:
    m = Chem.MolFromSmiles(s)
    exp_at, exp_bd = rd_labels(m)
    mh = Chem.AddHs(m)
    AllChem.EmbedMolecule(mh, randomSeed=7)
    conf = mh.GetConformer()
    mol = to_mol(m, conf)   # heavy atoms only; H implicit (mh keeps heavy-atom indices first)
    C._cache.clear()
    for i in range(m.GetNumAtoms()):
        if m.GetAtomWithIdx(i).GetAtomicNum() != 6: continue
        if m.GetAtomWithIdx(i).GetDegree() + m.GetAtomWithIdx(i).GetTotalNumHs() != 4: continue
        lab, info = C.assign_center(mol, i)
        e = exp_at.get(i, '-')
        got = lab if lab in ('R','S') else '-'
        total += 1
        if got != e:
            bad += 1; print('MISMATCH', s, 'atom', i, 'expected', e, 'got', lab, info)
print(f'tetrahedral: {total} centers checked, {bad} mismatches')

# E/Z on 3D conformers via my ez logic is grid-specific; test the ranking part with a planar projection instead
