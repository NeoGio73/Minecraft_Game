from rdkit import Chem
from rdkit.Chem import rdMolDescriptors as D
import itertools, sys

LIB = """
methane|CH4|C
ethane|C2H6|CC
propane|C3H8|CCC
butane|C4H10|CCCC
2-methylpropane (isobutane)|C4H10|CC(C)C
pentane|C5H12|CCCCC
2-methylbutane|C5H12|CCC(C)C
2,2-dimethylpropane (neopentane)|C5H12|CC(C)(C)C
hexane|C6H14|CCCCCC
2-methylpentane|C6H14|CCCC(C)C
3-methylpentane|C6H14|CCC(C)CC
2,2-dimethylbutane|C6H14|CCC(C)(C)C
2,3-dimethylbutane|C6H14|CC(C)C(C)C
3-ethyl-2-methylhexane|C9H20|CCCC(CC)C(C)C
cyclobutane|C4H8|C1CCC1
cyclohexane|C6H12|C1CCCCC1
ethene|C2H4|C=C
propene|C3H6|CC=C
1-butene|C4H8|CCC=C
2-butene|C4H8|CC=CC
2-methylpropene|C4H8|CC(C)=C
2-methyl-2-butene|C5H10|CC=C(C)C
1,3-butadiene|C4H6|C=CC=C
1,2-butadiene|C4H6|CC=C=C
cyclohexene|C6H10|C1CCC=CC1
ethyne|C2H2|C#C
propyne|C3H4|CC#C
1-butyne|C4H6|CCC#C
2-butyne|C4H6|CC#CC
3-hexyne|C6H10|CCC#CCC
methanol|CH4O|CO
ethanol|C2H6O|CCO
1-propanol|C3H8O|CCCO
2-propanol|C3H8O|CC(C)O
1-butanol|C4H10O|CCCCO
2-butanol|C4H10O|CCC(C)O
2-methyl-2-propanol (tert-butanol)|C4H10O|CC(C)(C)O
ethylene glycol|C2H6O2|OCCO
dimethyl ether|C2H6O|COC
diethyl ether|C4H10O|CCOCC
formaldehyde|CH2O|C=O
acetaldehyde|C2H4O|CC=O
propanal|C3H6O|CCC=O
2-methylpropanal|C4H8O|CC(C)C=O
acetone|C3H6O|CC(C)=O
2-butanone|C4H8O|CCC(C)=O
2-pentanone|C5H10O|CCCC(C)=O
3-pentanone|C5H10O|CCC(=O)CC
3-methyl-2-butanone|C5H10O|CC(C)C(C)=O
cyclohexanone|C6H10O|O=C1CCCCC1
formic acid|CH2O2|OC=O
acetic acid|C2H4O2|CC(=O)O
propanoic acid|C3H6O2|CCC(=O)O
methyl acetate|C3H6O2|COC(C)=O
ethyl acetate|C4H8O2|CCOC(C)=O
acetyl chloride|C2H3ClO|CC(=O)Cl
acetic anhydride|C4H6O3|CC(=O)OC(C)=O
acetamide|C2H5NO|CC(N)=O
N-methylacetamide|C3H7NO|CNC(C)=O
N,N-dimethylformamide|C3H7NO|CN(C)C=O
urea|CH4N2O|NC(N)=O
methylamine|CH5N|CN
ethylamine|C2H7N|CCN
dimethylamine|C2H7N|CNC
N-methylethanamine|C3H9N|CCNC
trimethylamine|C3H9N|CN(C)C
acetonitrile|C2H3N|CC#N
butanenitrile|C4H7N|CCCC#N
chloromethane|CH3Cl|CCl
chloroethane|C2H5Cl|CCCl
2-chloropropane|C3H7Cl|CC(C)Cl
bromoethane|C2H5Br|CCBr
1-bromopropane|C3H7Br|CCCBr
2-bromopropane|C3H7Br|CC(C)Br
1-bromobutane|C4H9Br|CCCCBr
2-bromobutane|C4H9Br|CCC(C)Br
1-bromo-2-methylpropane|C4H9Br|CC(C)CBr
2-bromo-2-methylpropane (tert-butyl bromide)|C4H9Br|CC(C)(C)Br
2-bromo-2-methylbutane|C5H11Br|CCC(C)(C)Br
1,2-dibromoethane|C2H4Br2|BrCCBr
dichloromethane|CH2Cl2|ClCCl
chloroform|CHCl3|ClC(Cl)Cl
methanethiol|CH4S|CS
ethanethiol|C2H6S|CCS
dimethyl sulfide|C2H6S|CSC
glycine|C2H5NO2|NCC(=O)O
alanine (stereo stripped)|C3H7NO2|CC(N)C(=O)O
lactic acid (stereo stripped)|C3H6O3|CC(O)C(=O)O
benzene|C6H6|c1ccccc1
toluene|C7H8|Cc1ccccc1
o-xylene|C8H10|Cc1ccccc1C
m-xylene|C8H10|Cc1cccc(C)c1
p-xylene|C8H10|Cc1ccc(C)cc1
phenol|C6H6O|Oc1ccccc1
aniline|C6H7N|Nc1ccccc1
chlorobenzene|C6H5Cl|Clc1ccccc1
benzoic acid|C7H6O2|OC(=O)c1ccccc1
salicylic acid|C7H6O3|OC(=O)c1ccccc1O
aspirin|C9H8O4|CC(=O)Oc1ccccc1C(=O)O
acetaminophen|C8H9NO2|CC(=O)Nc1ccc(O)cc1
ibuprofen (stereo stripped)|C13H18O2|CC(C)Cc1ccc(cc1)C(C)C(=O)O
"""
rows=[l.split('|') for l in LIB.strip().splitlines()]
bad=0
canon={}
for name,f,s in rows:
    m=Chem.MolFromSmiles(s)
    if m is None: print("PARSE FAIL",name); bad+=1; continue
    ff=D.CalcMolFormula(m)
    if ff!=f: print("FORMULA MISMATCH",name,f,ff); bad+=1
    c=Chem.MolToSmiles(m)
    if c in canon: print("DUP",name,canon[c])
    canon[c]=name
print("library rows",len(rows),"bad",bad)

# ---- induced embedding in cubic lattice (heavy atoms only)
DIRS=[(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]
def embed(m):
    n=m.GetNumAtoms()
    if n==0: return True
    adj=[set() for _ in range(n)]
    for b in m.GetBonds():
        a,c=b.GetBeginAtomIdx(),b.GetEndAtomIdx(); adj[a].add(c); adj[c].add(a)
    # BFS order from highest degree
    start=max(range(n),key=lambda i:len(adj[i]))
    order=[start]; seen={start}; q=[start]
    while q:
        u=q.pop(0)
        for v in sorted(adj[u]):
            if v not in seen: seen.add(v); order.append(v); q.append(v)
    assert len(order)==n
    pos={}; occ={}
    def ok(v,p):
        # all placed neighbours must be adjacent to p, all placed non-neighbours must not
        for u,pu in pos.items():
            d=abs(pu[0]-p[0])+abs(pu[1]-p[1])+abs(pu[2]-p[2])
            if u in adj[v]:
                if d!=1: return False
            else:
                if d==1: return False
        return True
    def rec(i):
        if i==n: return True
        v=order[i]
        if i==0:
            cands=[(0,0,0)]
        else:
            anchors=[pos[u] for u in adj[v] if u in pos]
            a=anchors[0]
            cands=[(a[0]+d[0],a[1]+d[1],a[2]+d[2]) for d in DIRS]
        for p in cands:
            if p in occ: continue
            if not ok(v,p): continue
            pos[v]=p; occ[p]=v
            if rec(i+1): return True
            del pos[v]; del occ[p]
        return False
    return rec(0)
fail=[]
for name,f,s in rows:
    m=Chem.MolFromSmiles(s)
    if not embed(m): fail.append(name)
print("unembeddable:",fail)

# ---- enumerations for predicate/set challenges
def iso_count(formula_smiles_list):
    pass
print("check C6H14 isomers distinct:",len({Chem.MolToSmiles(Chem.MolFromSmiles(s)) for s in ["CCCCCC","CCCC(C)C","CCC(C)CC","CCC(C)(C)C","CC(C)C(C)C"]}))
print("check C4H9Br isomers distinct:",len({Chem.MolToSmiles(Chem.MolFromSmiles(s)) for s in ["CCCCBr","CCC(C)Br","CC(C)CBr","CC(C)(C)Br"]}))
print("acyclic C4H8:",len({Chem.MolToSmiles(Chem.MolFromSmiles(s)) for s in ["CCC=C","CC=CC","CC(C)=C"]}))
# C5H10O ketones: enumerate C5 carbon skeletons with a ketone: 2-pentanone, 3-pentanone, 3-methyl-2-butanone; check no other
cands=["CCCC(C)=O","CCC(=O)CC","CC(C)C(C)=O","CC(C)(C)C=O","CCCCC=O","CCC(C)C=O","CC(C)CC=O"]
for s in cands:
    m=Chem.MolFromSmiles(s); print(s, D.CalcMolFormula(m), "ketone" if m.HasSubstructMatch(Chem.MolFromSmarts("[#6][CX3](=O)[#6]")) else "aldehyde")
# allene alkene oracle
for s in ["CC=C=C","C=CC=C","c1ccccc1","C=Cc1ccccc1"]:
    m=Chem.MolFromSmiles(s)
    print(s,"[CX3]=[CX3]",len(m.GetSubstructMatches(Chem.MolFromSmarts("[CX3]=[CX3]"))),"[#6;X3,X2]=[#6;X3,X2]",len(m.GetSubstructMatches(Chem.MolFromSmarts("[#6;X3,X2;!a]=[#6;X3,X2;!a]"))))
# hybridization of propyne
m=Chem.MolFromSmiles("CC#C"); print("propyne hyb",[str(a.GetHybridization()) for a in m.GetAtoms()])
# DoU check
for name,f,s in rows:
    m=Chem.MolFromSmiles(s)
    C=sum(1 for a in m.GetAtoms() if a.GetSymbol()=='C'); N=sum(1 for a in m.GetAtoms() if a.GetSymbol()=='N')
    X=sum(1 for a in m.GetAtoms() if a.GetSymbol() in ('F','Cl','Br','I')); H=sum(a.GetTotalNumHs() for a in m.GetAtoms())
    dou=(2*C+2+N-H-X)/2
    Chem.Kekulize(m,clearAromaticFlags=True)
    pi=sum({1.0:0,2.0:1,3.0:2}[b.GetBondTypeAsDouble()] for b in m.GetBonds())
    rings=m.GetNumBonds()-m.GetNumAtoms()+1
    if dou!=pi+rings: print("DOU MISMATCH",name,dou,pi,rings)
print("done")
