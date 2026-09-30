from rdkit import Chem
pt = Chem.GetPeriodicTable()
print("== RDKit default valence lists (Chem.GetPeriodicTable().GetValenceList) ==")
for sym in ["H","B","C","N","O","F","Si","P","S","Cl","Br","I"]:
    n = pt.GetAtomicNumber(sym)
    print(sym, list(pt.GetValenceList(n)))

print("\n== hypervalent / charged handling ==")
for smi in ["CS(=O)(=O)C","CS(C)=O","OP(O)(O)=O","CP(C)(C)(C)C","C[N+](C)(C)C","CN(C)(C)C","O=[N+]([O-])c1ccccc1","[O-]C(=O)C","C[O+](C)C","CS(C)(C)C","OS(O)(=O)=O","FS(F)(F)(F)(F)F"]:
    m = Chem.MolFromSmiles(smi, sanitize=False)
    try:
        Chem.SanitizeMol(m); status="sanitizes OK"
    except Exception as e:
        status="REJECTED: "+str(e).split('\n')[0]
    print(f"{smi:28s} {status}")

print("\n== implicit H counts computed by RDKit (valence - explicit bond order sum) ==")
for smi in ["C","CC","C=C","C#C","c1ccccc1","N","CN","C=N","C#N","O","CO","C=O","S","CS","Cl","CCl","c1ccncc1","c1cc[nH]c1","Cc1ccccc1"]:
    m = Chem.MolFromSmiles(smi)
    print(f"{smi:12s}", [(a.GetSymbol(), a.GetTotalNumHs(), a.GetExplicitValence() if hasattr(a,'GetExplicitValence') else a.GetValence(Chem.ValenceType.EXPLICIT)) for a in m.GetAtoms()])

# Functional group SMARTS proposals (naive + corrected) tested on a probe set
groups = {
 "alkene (naive)":            "C=C",
 "alkene (non-aromatic)":     "[C;!$(C=O)]=[C]",  # not needed; simplest is [CX3]=[CX3]
 "alkene [CX3]=[CX3]":        "[CX3]=[CX3]",
 "alkyne":                    "[CX2]#[CX2]",
 "aromatic ring 6 atoms":     "a1aaaaa1",
 "aromatic any":              "a",
 "alcohol (naive [OX2H])":    "[OX2H]",
 "alcohol (aliphatic C-OH, excl acid/enol/phenol)": "[OX2H][CX4]",
 "alcohol primary":           "[OX2H][CX4;H2]",
 "alcohol secondary":         "[OX2H][CX4;H1]",
 "alcohol tertiary":          "[OX2H][CX4;H0]",
 "methanol special":          "[OX2H][CX4;H3]",
 "phenol":                    "[OX2H]c",
 "ether (naive COC)":         "COC",
 "ether (excl ester/acid)":   "[OD2]([#6;!$(C=O)])[#6;!$(C=O)]",
 "aldehyde":                  "[CX3H1](=O)[#6,#1]",
 "aldehyde (incl formaldehyde)": "[CX3H1,CX3H2]=O",
 "ketone":                    "[#6][CX3](=O)[#6]",
 "carboxylic acid":           "[CX3](=O)[OX2H1]",
 "ester":                     "[#6][CX3](=O)[OX2][#6]",
 "ester (incl formate)":      "[CX3;!$(C(=O)O[H])](=O)[OX2][#6]",
 "amide":                     "[CX3](=O)[NX3]",
 "amine (naive N)":           "[NX3]",
 "amine (excl amide/aromatic/nitro)": "[NX3;!$(N-C=O);!$(N-[a]);!$([N+]);!$(N-S=O)]",
 "amine primary":             "[NX3;H2;!$(N-C=O);!$(N-[a])][#6]",
 "amine secondary":           "[NX3;H1;!$(N-C=O);!$(N-[a])]([#6])[#6]",
 "amine tertiary":            "[NX3;H0;!$(N-C=O);!$(N-[a])]([#6])([#6])[#6]",
 "aniline-type (aryl amine)": "[NX3;H2]c",
 "nitrile":                   "[CX2]#[NX1]",
 "alkyl halide":              "[CX4][F,Cl,Br,I]",
 "aryl halide":               "c[F,Cl,Br,I]",
 "acyl halide":               "[CX3](=O)[F,Cl,Br,I]",
 "thiol":                     "[SX2H1][#6]",
 "thioether/sulfide":         "[SX2]([#6])[#6]",
 "carbonyl any":              "[CX3]=[OX1]",
 "acid anhydride":            "[CX3](=O)[OX2][CX3](=O)",
 "nitro":                     "[NX3+](=O)[O-]",
}
probes = {
 "ethanol":"CCO","2-propanol":"CC(C)O","tert-butanol":"CC(C)(C)O","methanol":"CO",
 "acetic acid":"CC(=O)O","formic acid":"OC=O","phenol":"Oc1ccccc1","ethyl acetate":"CCOC(C)=O",
 "diethyl ether":"CCOCC","acetone":"CC(C)=O","acetaldehyde":"CC=O","formaldehyde":"C=O",
 "acetamide":"CC(N)=O","N-methylacetamide":"CNC(C)=O","DMF":"CN(C)C=O",
 "methylamine":"CN","dimethylamine":"CNC","trimethylamine":"CN(C)C","aniline":"Nc1ccccc1","pyridine":"c1ccncc1",
 "acetonitrile":"CC#N","chloroethane":"CCCl","chlorobenzene":"Clc1ccccc1","acetyl chloride":"CC(=O)Cl",
 "ethanethiol":"CCS","dimethyl sulfide":"CSC","benzene":"c1ccccc1","ethene":"C=C","ethyne":"C#C",
 "aspirin":"CC(=O)Oc1ccccc1C(=O)O","acetaminophen":"CC(=O)Nc1ccc(O)cc1","vinyl alcohol (enol)":"C=CO",
 "acetic anhydride":"CC(=O)OC(C)=O","nitrobenzene":"O=[N+]([O-])c1ccccc1","benzaldehyde":"O=Cc1ccccc1",
 "methyl formate":"COC=O","cyclohexanol":"OC1CCCCC1","2-butene":"CC=CC","furan":"c1ccoc1",
}
print("\n== SMARTS hits on probe set ==")
mols = {k: Chem.MolFromSmiles(v) for k,v in probes.items()}
for gname, smarts in groups.items():
    q = Chem.MolFromSmarts(smarts)
    if q is None: print("BAD SMARTS", gname, smarts); continue
    hits = [k for k,m in mols.items() if m.HasSubstructMatch(q)]
    print(f"{gname:48s} {smarts:45s} -> {hits}")
