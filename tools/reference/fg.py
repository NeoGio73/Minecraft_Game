from rdkit import Chem
# (name, SMARTS, indices of atoms in the match that get CLAIMED)
RULES = [
 ("carboxylic_acid", "[CX3](=[OX1])[OX2H1]", [0,1,2]),
 ("acid_anhydride",  "[CX3](=[OX1])[OX2][CX3](=[OX1])", [0,1,2,3,4]),
 ("ester",           "[CX3](=[OX1])[OX2][#6]", [0,1,2]),
 ("thioester",       "[CX3](=[OX1])[SX2][#6]", [0,1,2]),
 ("acid_chloride",   "[CX3](=[OX1])[F,Cl,Br,I]", [0,1,2]),
 ("amide",           "[CX3](=[OX1])[NX3]", [0,1,2]),
 ("nitrile",         "[CX2]#[NX1]", [0,1]),
 ("aldehyde",        "[CX3;H1,H2](=[OX1])", [0,1]),
 ("ketone",          "[#6][CX3](=[OX1])[#6]", [1,2]),
 ("imine",           "[CX3]=[NX2]", [0,1]),
 ("sulfoxide",       "[#6][SX3](=[OX1])[#6]", [1,2]),
 ("alcohol",         "[#6][OX2H1]", [1]),
 ("thiol",           "[#6][SX2H1]", [1]),
 ("disulfide",       "[#6][SX2][SX2][#6]", [1,2]),
 ("ether",           "[#6][OX2][#6]", [1]),
 ("sulfide",         "[#6][SX2][#6]", [1]),
 ("amine",           "[NX3;!$([N]=*);!$([N]#*)]([#6])", [0]),
 ("halide",          "[#6][F,Cl,Br,I]", [1]),
 ("arene",           "[c]1[c][c][c][c][c]1", [0,1,2,3,4,5]),
 ("alkyne",          "[CX2]#[CX2]", [0,1]),
 ("alkene",          "[CX3]=[CX3]", [0,1]),
]
def detect(smi):
    m=Chem.MolFromSmiles(smi)
    claimed=set(); found=[]
    for name,sma,claim_idx in RULES:
        patt=Chem.MolFromSmarts(sma)
        for match in m.GetSubstructMatches(patt):
            key=[match[i] for i in claim_idx]
            if any(a in claimed for a in key): continue
            claimed.update(key); found.append(name)
    if not found: found=["alkane" if all(a.GetSymbol() in 'CH' for a in m.GetAtoms()) else "unclassified"]
    return found
tests = {
 "ethanoic acid":"CC(=O)O", "methyl ethanoate":"CC(=O)OC", "ethyl ethanoate":"CC(=O)OCC", "ethanamide":"CC(N)=O",
 "N-methylethanamide":"CC(=O)NC", "propanone":"CC(C)=O", "ethanal":"CC=O", "methanal":"C=O", "methanoic acid":"OC=O",
 "ethanol":"CCO", "dimethyl ether":"COC", "methylamine":"CN", "trimethylamine":"CN(C)C", "ethanenitrile":"CC#N",
 "lactic acid":"CC(O)C(=O)O", "alanine":"CC(N)C(=O)O", "1-bromopropan-2-ol":"CC(O)CBr", "2-chlorobut-2-ene":"CC=C(C)Cl",
 "benzene":"c1ccccc1", "cyclohexene":"C1CCC=CC1", "propyne":"C#CC", "hexane":"CCCCCC", "cyclohexane":"C1CCCCC1",
 "bromocyclohexane":"BrC1CCCCC1", "methanethiol":"CS", "dimethyl sulfide":"CSC", "ethanoic anhydride":"CC(=O)OC(C)=O",
 "ethanoyl chloride":"CC(=O)Cl", "acetone imine":"CC(C)=N", "DMSO":"CS(C)=O", "dimethyl disulfide":"CSSC",
 "methyl ethanethioate":"CC(=O)SC", "cyclohexanone":"O=C1CCCCC1", "3-bromocyclohexene":"BrC1CCCC=C1",
 "but-3-enoic acid":"C=CCC(=O)O", "ethane-1,2-diol":"OCCO", "oxirane":"C1CO1", "hexan-3-one":"CCC(=O)CCC",
 "phenol":"Oc1ccccc1", "2-hydroxypropanal (enol-free)":"CC(O)C=O",
}
for n,s in tests.items():
    print(f"{n:32s} {s:18s} -> {detect(s)}")
