from rdkit import Chem
from rdkit.Chem import AllChem, rdMolDescriptors as D, rdCIPLabeler
import numpy as np
extra = """3-methylbutan-2-ol|CC(C)C(C)O
1-bromo-1-methylcyclohexane|CC1(Br)CCCCC1
2-chloro-2-methylbutane|CCC(C)(C)Cl
2-chloro-3-methylbutane|CC(C)C(C)Cl
pentanenitrile|CCCCC#N
1,2-dimethylcyclohexene|CC1=C(C)CCCC1
2-bromo-5-methylhexane|CC(Br)CCC(C)C
methylcyclobutane|CC1CCC1
1-chloropropane|CCCCl
pent-2-yne|CC#CCC
dec-5-yne|CCCCC#CCCCC
ethylcyclobutene|CCC1=CCC1
2-methylcyclohexanol|CC1CCCCC1O
2-bromocyclohexanol|OC1CCCCC1Br
ethyl formate|CCOC=O
N-methylformamide|CNC=O
ethylcyclopropane|CCC1CC1
1,1-dimethylcyclopropane|CC1(C)CC1
propanamide|CCC(N)=O
4-methylpent-1-ene|C=CCC(C)C"""
print("=== extra formulas ===")
for line in extra.splitlines():
    n,s=line.split('|'); m=Chem.MolFromSmiles(s)
    print(f"{n:30s} {s:20s} canon={Chem.MolToSmiles(m):20s} {D.CalcMolFormula(m)}")
print("\n=== stereo labels for ring products ===")
for s in ["C[C@H]1CCCC[C@@H]1O","C[C@H]1CCCC[C@H]1O","C[C@@H]1CCCC[C@H]1O","C[C@@H]1CCCC[C@@H]1O"]:
    m=Chem.MolFromSmiles(s); rdCIPLabeler.AssignCIPLabels(m)
    labs=[f"{a.GetIdx()}:{a.GetProp('_CIPCode')}" for a in m.GetAtoms() if a.HasProp('_CIPCode')]
    mirror=s.replace('@@','##').replace('@','@@').replace('##','@')
    meso=Chem.MolToSmiles(m)==Chem.MolToSmiles(Chem.MolFromSmiles(mirror))
    # cis/trans from 3D: sign of (sub1 - ring1) . (sub2 - ring2) projected on ring normal
    mh=Chem.AddHs(m); AllChem.EmbedMolecule(mh,randomSeed=7); conf=mh.GetConformer()
    ring=[a.GetIdx() for a in mh.GetAtoms() if a.IsInRing() and a.GetSymbol()=='C']
    pts=np.array([list(conf.GetAtomPosition(i)) for i in ring]); c=pts.mean(0)
    u,sv,vt=np.linalg.svd(pts-c); normal=vt[2]
    subs=[]
    for a in mh.GetAtoms():
        if a.GetSymbol() in 'OC' and not a.IsInRing():
            nb=[n for n in a.GetNeighbors() if n.IsInRing()][0]
            v=np.array(list(conf.GetAtomPosition(a.GetIdx())))-np.array(list(conf.GetAtomPosition(nb.GetIdx())))
            subs.append(np.dot(v,normal))
    rel="cis" if subs[0]*subs[1]>0 else "trans"
    print(f"{s:28s} labels={labs} meso={meso} 3D-relation={rel}")
print("\n=== triple-product sign convention check on 2-bromobutane ===")
for s in ["CC[C@@H](C)Br","CC[C@H](C)Br","C[C@H](O)C(=O)O","C[C@@H](N)C(=O)O"]:
    m=Chem.AddHs(Chem.MolFromSmiles(s)); AllChem.EmbedMolecule(m,randomSeed=11); AllChem.MMFFOptimizeMolecule(m)
    rdCIPLabeler.AssignCIPLabels(m); conf=m.GetConformer()
    for a in m.GetAtoms():
        if not a.HasProp('_CIPCode'): continue
        lab=a.GetProp('_CIPCode')
        # rank neighbors by CIP rank via _CIPRank property (RDKit legacy) -> use AssignStereochemistry ranks
        Chem.AssignStereochemistry(m,cleanIt=False,force=True)
        nbrs=sorted(a.GetNeighbors(), key=lambda n:int(n.GetProp('_CIPRank')), reverse=True)  # highest rank first
        P=[np.array(list(conf.GetAtomPosition(n.GetIdx()))) for n in nbrs]
        tp=np.dot(P[0]-P[3], np.cross(P[1]-P[3], P[2]-P[3]))
        print(f"{s:22s} center {a.GetIdx()} CIP={lab}  neighbors(high->low)={[n.GetSymbol() for n in nbrs]}  triple=(p1-p4).((p2-p4)x(p3-p4))={tp:+.3f}")
