from rdkit import Chem
from rdkit.Chem import rdCIPLabeler
from rdkit import RDLogger; RDLogger.DisableLog('rdApp.*')
def lab(smi):
    m = Chem.MolFromSmiles(smi); rdCIPLabeler.AssignCIPLabels(m); out=[]
    for a in m.GetAtoms():
        if a.HasProp('_CIPCode'): out.append(f"{a.GetSymbol()}{a.GetIdx()+1}:{a.GetProp('_CIPCode')}")
    for b in m.GetBonds():
        if b.HasProp('_CIPCode'): out.append(f"={b.GetBeginAtomIdx()+1}-{b.GetEndAtomIdx()+1}:{b.GetProp('_CIPCode')}")
    return ' '.join(out) or '(none)'
def can(s): return Chem.MolToSmiles(Chem.MolFromSmiles(s))
def mirror(s): return s.replace('@@','\x00').replace('@','@@').replace('\x00','@')
lib = [
 ('(R)-2-butanol','C[C@@H](O)CC'),('(S)-2-butanol','C[C@H](O)CC'),
 ('(R)-2-bromobutane','C[C@@H](Br)CC'),('(S)-2-bromobutane','C[C@H](Br)CC'),
 ('(S)-alanine (L)','N[C@@H](C)C(=O)O'),('(R)-alanine (D)','N[C@H](C)C(=O)O'),
 ('(S)-lactic acid (L, (+))','C[C@H](O)C(=O)O'),('(R)-lactic acid (D, (-))','C[C@@H](O)C(=O)O'),
 ('(R)-glyceraldehyde (D)','O=C[C@H](O)CO'),('(S)-glyceraldehyde (L)','O=C[C@@H](O)CO'),
 ('meso-2,3-dibromobutane (2R,3S)','C[C@H](Br)[C@H](Br)C'),('(2R,3R)-2,3-dibromobutane','C[C@@H](Br)[C@H](Br)C'),('(2S,3S)-2,3-dibromobutane','C[C@H](Br)[C@@H](Br)C'),
 ('(R)-3-methylhexane','CCC[C@H](C)CC'),('(S)-3-methylhexane','CCC[C@@H](C)CC'),
 ('cis-1-bromo-2-methylcyclohexane (1R,2S)','C[C@H]1CCCC[C@H]1Br'),('cis-1-bromo-2-methylcyclohexane (1S,2R)','C[C@@H]1CCCC[C@@H]1Br'),
 ('trans-1-bromo-2-methylcyclohexane (1R,2R)','C[C@@H]1CCCC[C@H]1Br'),('trans-1-bromo-2-methylcyclohexane (1S,2S)','C[C@H]1CCCC[C@@H]1Br'),
 ('cis-1,2-dimethylcyclohexane (meso)','C[C@H]1CCCC[C@H]1C'),('trans-1,2-dimethylcyclohexane (R,R)','C[C@@H]1CCCC[C@H]1C'),('trans-1,2-dimethylcyclohexane (S,S)','C[C@H]1CCCC[C@@H]1C'),
 ('cis-1,4-dimethylcyclohexane (no chirality centers)','C[C@H]1CC[C@@H](C)CC1'),('trans-1,4-dimethylcyclohexane','C[C@H]1CC[C@H](C)CC1'),
 ('meso-tartaric acid','OC(=O)[C@H](O)[C@H](O)C(=O)O'),('(2R,3R)-tartaric acid (L-(+))','OC(=O)[C@H](O)[C@@H](O)C(=O)O'),
 ('L-threonine (2S,3R)','C[C@@H](O)[C@H](N)C(=O)O'),
 ('(S)-2-methylcyclohexanone','C[C@H]1CCCCC1=O'),('(R)-3-methylcyclohexene','C[C@H]1C=CCCC1'),
 ('(R)-1-phenylethanol','C[C@@H](O)c1ccccc1'),('(R)-carvone (spearmint)','CC(=C)[C@@H]1CC=C(C)C(=O)C1'),
 ('(E)-but-2-ene','C/C=C/C'),('(Z)-but-2-ene','C/C=C\\C'),
 ('(E)-2-chloro-2-butene','C/C=C(/Cl)C'),('(Z)-2-chloro-2-butene','C/C=C(\\Cl)C'),
 ('(E)-3-methylpent-2-ene','C/C=C(\\C)CC'),('(Z)-3-methylpent-2-ene','C/C=C(/C)CC'),
 ('(E)-1-bromo-1-chloropropene','Br/C(Cl)=C/C'),('(Z)-1-bromo-1-chloropropene','Br/C(Cl)=C\\C'),
 ('(E)-hex-3-ene','CC/C=C/CC'),('(Z)-hex-3-ene','CC/C=C\\CC'),('(E)-pent-2-ene','C/C=C/CC'),
 ('(2E,4E)-hexa-2,4-diene','C/C=C/C=C/C'),('(E)-1,2-dichloroethene','Cl/C=C/Cl'),('(Z)-1,2-dichloroethene','Cl/C=C\\Cl'),
 ('2-methylbut-2-ene (no E/Z)','CC=C(C)C'),('propene (no E/Z)','CC=C'),
]
print(f"{'name':48s} {'smiles':34s} {'RDKit CIP (1-based atom idx)':34s} {'meso?':6s} canonical")
for n,s in lib:
    print(f"{n:48s} {s:34s} {lab(s):34s} {str(can(s)==can(mirror(s))):6s} {can(s)}")
