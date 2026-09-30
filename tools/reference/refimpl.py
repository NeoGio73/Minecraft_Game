"""Reference implementation of the exact algorithms recommended for the browser:
 1. SMILES-subset parser -> labeled graph (atoms, bonds, branches, ring closures, aromatic lowercase, [..] bracket atoms w/ H count and charge)
 2. Implicit-H computation from valence minus bond-order sum (aromatic bond counted as 1.5 -> use OpenSMILES rule: aromatic atoms get 1 implicit H if needed)
 3. WL / Morgan-style canonical hash (iterated neighbourhood hashing, sorted multiset) -> quick reject
 4. VF2-style backtracking isomorphism with degree-ordered candidate selection -> confirmation
Cross-checked against RDKit's canonical SMILES on isomer families.
"""
import hashlib, itertools, sys
from rdkit import Chem
from rdkit.Chem import rdMolDescriptors

ORGANIC = {"B":[3],"C":[4],"N":[3,5],"O":[2],"P":[3,5],"S":[2,4,6],"F":[1],"Cl":[1],"Br":[1],"I":[1]}
# valences the BUILDER should enforce (neutral atoms): C4 N3 O2 X1 S2 (allow 4/6 as advanced), P3(5 advanced)

def parse_smiles(s):
    atoms=[]; bonds=[]  # atoms: dict(el, arom, hcount(None=implicit), charge); bonds: (i,j,order) order 1,2,3 or 'ar'
    stack=[]; prev=None; pending_bond=None; ring={}
    i=0; n=len(s)
    def add_atom(el, arom, h=None, chg=0):
        atoms.append({"el":el,"arom":arom,"h":h,"chg":chg}); return len(atoms)-1
    def add_bond(a,b,order):
        bonds.append((a,b,order))
    while i<n:
        c=s[i]
        if c=='(':
            stack.append(prev); i+=1; continue
        if c==')':
            prev=stack.pop(); i+=1; continue
        if c in '-=#:':
            pending_bond={'-':1,'=':2,'#':3,':':'ar'}[c]; i+=1; continue
        if c in '/\\':  # stereo bond marks: treat as single (no stereo initially)
            pending_bond=1; i+=1; continue
        if c=='.':
            prev=None; pending_bond=None; i+=1; continue
        if c.isdigit() or c=='%':
            if c=='%': num=int(s[i+1:i+3]); i+=3
            else: num=int(c); i+=1
            if num in ring:
                a,order0=ring.pop(num)
                order = pending_bond if pending_bond is not None else order0
                if order is None:
                    order = 'ar' if (atoms[a]['arom'] and atoms[prev]['arom']) else 1
                add_bond(a,prev,order)
            else:
                ring[num]=(prev,pending_bond)
            pending_bond=None; continue
        if c=='[':
            j=s.index(']',i); tok=s[i+1:j]; i=j+1
            k=0
            while k<len(tok) and tok[k].isdigit(): k+=1   # isotope, ignore
            tok=tok[k:]
            if tok[:2] in ('Cl','Br') : el=tok[:2]; tok=tok[2:]
            elif tok[:2] in ('se','as'): el=tok[:2].capitalize(); tok=tok[2:]
            else: el=tok[0]; tok=tok[1:]
            arom = el.islower(); el=el.capitalize()
            if tok.startswith('@@'): tok=tok[2:]
            elif tok.startswith('@'): tok=tok[1:]
            h=0
            if tok.startswith('H'):
                tok=tok[1:]; h=1
                k=0
                while k<len(tok) and tok[k].isdigit(): k+=1
                if k: h=int(tok[:k]); tok=tok[k:]
            chg=0
            if tok.startswith('+') or tok.startswith('-'):
                sign=1 if tok[0]=='+' else -1; tok=tok[1:]
                if tok and tok[0].isdigit(): chg=sign*int(tok[0]); tok=tok[1:]
                else:
                    cnt=1
                    while tok and tok[0] in '+-': cnt+=1; tok=tok[1:]
                    chg=sign*cnt
            a=add_atom(el,arom,h,chg)
        else:
            if s[i:i+2] in ('Cl','Br'): el=s[i:i+2]; i+=2; arom=False
            elif c in 'BCNOPSFI': el=c; i+=1; arom=False
            elif c in 'bcnops': el=c.upper(); i+=1; arom=True
            else: raise ValueError("unexpected char %r at %d in %s"%(c,i,s))
            a=add_atom(el,arom)
        if prev is not None:
            order=pending_bond
            if order is None:
                order='ar' if (atoms[prev]['arom'] and atoms[a]['arom']) else 1
            add_bond(prev,a,order)
        prev=a; pending_bond=None
    assert not ring, "unclosed ring bonds %r"%ring
    return atoms,bonds

def kekulize_and_hcount(atoms,bonds):
    """Return per-atom implicit H using OpenSMILES organic-subset rule.
    Aromatic bonds: we do a simple Kekulization (perfect matching on aromatic subgraph) so bond orders become 1/2,
    then H = smallest allowed valence >= bond-order-sum, minus bond-order-sum (charge ignored for neutral organic subset)."""
    n=len(atoms)
    adj=[[] for _ in range(n)]
    for bi,(a,b,o) in enumerate(bonds): adj[a].append((b,bi)); adj[b].append((a,bi))
    order=[o for (_,_,o) in bonds]
    # kekulize: aromatic atoms that need a double bond = those whose explicit non-aromatic valence + 1 per aromatic bond + h < normal valence.
    arom_atoms=[i for i,a in enumerate(atoms) if a['arom']]
    if arom_atoms:
        need=set()
        for i in arom_atoms:
            a=atoms[i]
            bo=sum(1 if order[bi]=='ar' else order[bi] for _,bi in adj[i])
            h = a['h'] if a['h'] is not None else 0
            # OpenSMILES: aromatic atom in organic subset gets implicit H only if needed; heuristic: pyrrole-type N/O/S written [nH] or o/s don't need a double bond
            el=a['el']
            if el=='C':
                if bo+h<4: need.add(i)
            elif el=='N':
                if a['h'] is None and bo==2 and h==0: need.add(i)   # pyridine-type n
                # [nH] / n with 3 bonds: no double bond
            elif el in ('O','S'):
                pass
        # find perfect matching on 'need' atoms using aromatic bonds (backtracking; rings are small)
        arom_bonds=[bi for bi,(a,b,o) in enumerate(bonds) if o=='ar' and a in need and b in need]
        def match(remaining, used_bonds):
            if not remaining: return used_bonds
            i=min(remaining)
            for bi in arom_bonds:
                a,b,_=bonds[bi]
                if i in (a,b):
                    j=b if a==i else a
                    if j in remaining:
                        r=match(remaining-{i,j}, used_bonds+[bi])
                        if r is not None: return r
            return None
        m=match(frozenset(need),[])
        assert m is not None, "kekulization failed"
        for bi in range(len(order)):
            if order[bi]=='ar': order[bi]=2 if bi in m else 1
    hs=[]
    for i,a in enumerate(atoms):
        bo=sum(order[bi] for _,bi in adj[i])
        if a['h'] is not None: hs.append(a['h']); continue
        vals=ORGANIC.get(a['el'],[bo])
        v=next((v for v in vals if v>=bo), None)
        hs.append(0 if v is None else v-bo)
    return order,hs

def to_graph(smiles, keep_aromatic_flag=True):
    atoms,bonds=parse_smiles(smiles)
    order,hs=kekulize_and_hcount(atoms,bonds)
    # node label: element, implicit H count, charge, aromatic flag  (H count included so that ketone vs alcohol etc. differ)
    labels=[(a['el'],hs[i],a['chg'],a['arom'] if keep_aromatic_flag else False) for i,a in enumerate(atoms)]
    # edge label: bond order; for aromatic flagged bonds use 'ar' so kekule choice does not matter
    edges={}
    for (a,b,o),ko in zip(bonds,order):
        lab = 'ar' if (o=='ar' and keep_aromatic_flag) else ko
        edges[(a,b)]=lab; edges[(b,a)]=lab
    adj=[[] for _ in atoms]
    for (a,b),lab in edges.items(): adj[a].append((b,lab))
    return labels,adj

def formula(labels):
    from collections import Counter
    c=Counter()
    for el,h,chg,ar in labels: c[el]+=1; c['H']+=h
    parts=[]
    for el in ['C','H']+sorted(k for k in c if k not in('C','H')):
        if c[el]: parts.append(el+(str(c[el]) if c[el]>1 else ''))
    return ''.join(parts)

def wl_hash(labels,adj,rounds=None):
    n=len(labels)
    if rounds is None: rounds=n  # n rounds guarantee stabilisation
    col=[hashlib.sha1(repr(l).encode()).hexdigest()[:16] for l in labels]
    for _ in range(rounds):
        new=[]
        for i in range(n):
            nb=sorted((lab if isinstance(lab,str) else str(lab))+':'+col[j] for j,lab in adj[i])
            new.append(hashlib.sha1((col[i]+'|'+'|'.join(nb)).encode()).hexdigest()[:16])
        if sorted(new)==sorted(col) and len(set(new))==len(set(col)): col=new; break
        col=new
    return hashlib.sha1('|'.join(sorted(col)).encode()).hexdigest()[:24], col

def vf2_iso(l1,a1,l2,a2):
    """Graph isomorphism by backtracking with VF2-style candidate selection (extend from mapped frontier) and
    feasibility: label equal, degree equal, and every already-mapped neighbour must correspond with equal bond label."""
    n=len(l1)
    if n!=len(l2) or sorted(l1)!=sorted(l2): return None
    deg1=[len(x) for x in a1]; deg2=[len(x) for x in a2]
    if sorted(deg1)!=sorted(deg2): return None
    nb1=[dict(x) for x in a1]; nb2=[dict(x) for x in a2]
    m12=[-1]*n; m21=[-1]*n
    order=[]  # BFS-ish order of g1 so each next node touches the mapped set when possible
    seen=set()
    for s in sorted(range(n), key=lambda i:-deg1[i]):
        if s in seen: continue
        q=[s]; seen.add(s)
        while q:
            u=q.pop(0); order.append(u)
            for v,_ in a1[u]:
                if v not in seen: seen.add(v); q.append(v)
    def feasible(u,v):
        if l1[u]!=l2[v] or deg1[u]!=deg2[v]: return False
        for w,lab in a1[u]:
            if m12[w]!=-1:
                if nb2[v].get(m12[w])!=lab: return False
        for w,lab in a2[v]:
            if m21[w]!=-1 and nb1[u].get(m21[w])!=lab: return False
        return True
    def rec(k):
        if k==n: return True
        u=order[k]
        # candidates: neighbours of already-mapped images of u's mapped neighbours (frontier), else all unmapped
        cands=None
        for w,_ in a1[u]:
            if m12[w]!=-1:
                s={x for x,_ in a2[m12[w]] if m21[x]==-1}
                cands = s if cands is None else cands & s
        if cands is None: cands=[v for v in range(n) if m21[v]==-1]
        for v in cands:
            if feasible(u,v):
                m12[u]=v; m21[v]=u
                if rec(k+1): return True
                m12[u]=-1; m21[v]=-1
        return False
    return m12 if rec(0) else None

def same_molecule(s1,s2):
    l1,a1=to_graph(s1); l2,a2=to_graph(s2)
    h1,_=wl_hash(l1,a1); h2,_=wl_hash(l2,a2)
    if h1!=h2: return False, "wl-reject"
    return (vf2_iso(l1,a1,l2,a2) is not None), "vf2"

# ---------- tests ----------
def rd_canon(s): return Chem.MolToSmiles(Chem.MolFromSmiles(s))
def rd_formula(s): return rdMolDescriptors.CalcMolFormula(Chem.MolFromSmiles(s))

families = {
 "C4H10": ["CCCC","CC(C)C"],
 "C5H12": ["CCCCC","CCC(C)C","CC(C)(C)C"],
 "C6H14": ["CCCCCC","CCCCC(C)","CCCC(C)C","CCC(C)CC","CCC(C)(C)C","CC(C)C(C)C","CC(C)CC(C)"],  # includes duplicates written differently on purpose
 "C4H8 (constitutional)": ["C=CCC","CC=CC","C=C(C)C","C1CCC1","CC1CC1"],
 "C3H8O": ["CCCO","CC(C)O","COCC"],
 "C4H10O": ["CCCCO","CCC(C)O","CC(C)CO","CC(C)(C)O","CCOCC","COCCC","COC(C)C","OCCCC"],
 "C4H8O carbonyl": ["CCCC=O","CC(C)C=O","CCC(C)=O"],
 "C2H6O": ["CCO","COC"],
 "aromatic writing variants": ["c1ccccc1","C1=CC=CC=C1","c1ccccc1C","Cc1ccccc1","C1=CC=C(C)C=C1","CC1=CC=CC=C1"],
 "ring-closure variants": ["C1CCCCC1","C1CCCCC1","C2CCCCC2","C%10CCCCC%10","O=C1CCCCC1","C1(=O)CCCCC1"],
 "pyridine vs pyrrole vs benzene": ["c1ccncc1","c1cc[nH]c1","c1ccccc1","n1ccccc1"],
 "caffeine writings": ["Cn1cnc2c1c(=O)n(C)c(=O)n2C","CN1C=NC2=C1C(=O)N(C)C(=O)N2C"],
}
fail=0
for fam,smis in families.items():
    print("==",fam)
    for s in smis:
        l,a=to_graph(s); f=formula(l); rf=rd_formula(s)
        ok = f==rf
        if not ok: fail+=1
        print(f"  {s:32s} formula={f:10s} rdkit={rf:10s} {'OK' if ok else 'MISMATCH'}  wl={wl_hash(l,a)[0][:12]}")
    # pairwise compare vs RDKit truth
    for s1,s2 in itertools.combinations(smis,2):
        truth = rd_canon(s1)==rd_canon(s2)
        mine,how = same_molecule(s1,s2)
        if mine!=truth: fail+=1; print("   DISAGREE", s1, s2, "rdkit_same=",truth,"mine=",mine,how)
print("families done; disagreements:",fail)

# WL-hash collision stress: all pairs in the full library must agree with RDKit
lib = [l.split(",")[2] for l in open("/tmp/claude-0/-home-user-Minecraft-Game/8f0480a6-ca12-5fe0-96b2-f372903d1e22/scratchpad/lib.csv")]
lib=[s.strip() for s in lib if s.strip()]
# strip stereo marks for our parser (no stereo initially) -- compare against RDKit with stereo removed
def strip_stereo(s):
    m=Chem.MolFromSmiles(s); Chem.RemoveStereochemistry(m); return Chem.MolToSmiles(m)
lib_ns=[strip_stereo(s) for s in lib]
dis=0; pairs=0; wlrej=0
for s1,s2 in itertools.combinations(lib_ns,2):
    pairs+=1
    truth = rd_canon(s1)==rd_canon(s2)
    mine,how = same_molecule(s1,s2)
    if how=="wl-reject": wlrej+=1
    if mine!=truth: dis+=1; print("DISAGREE", s1,s2,truth,mine,how)
print(f"library pairs={pairs} wl-rejected={wlrej} vf2-checked={pairs-wlrej} disagreements={dis}")
# formula check on whole library with our parser
bad=0
for s in lib_ns:
    l,a=to_graph(s)
    if formula(l)!=rd_formula(s): bad+=1; print("FORMULA MISMATCH", s, formula(l), rd_formula(s))
print("library formula mismatches:", bad)
