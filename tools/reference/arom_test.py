import sys; sys.argv=['x']
exec(open('refimpl.py').read().split('# ---------- tests ----------')[0])
from rdkit import Chem
def rd_same(a,b): return Chem.MolToSmiles(Chem.MolFromSmiles(a))==Chem.MolToSmiles(Chem.MolFromSmiles(b))

def perceive_aromatic(labels, adj):
    """Simple aromaticity perception for the builder: any ring of 6 atoms whose ring bonds alternate single/double
    (each ring atom has exactly one ring double bond) -> relabel those 6 ring bonds 'ar'. Also mark atom aromatic flag.
    Works on Kekule graphs (what the voxel builder produces) so both Kekule forms map to the same graph."""
    n=len(labels)
    nb={i:{j:lab for j,lab in adj[i]} for i in range(n)}
    rings=[]
    # enumerate simple 6-cycles by DFS from each start (small molecules -> fine)
    def dfs(start,cur,path):
        if len(path)==6:
            if start in nb[cur]: rings.append(list(path))
            return
        for j in nb[cur]:
            if j not in path and j>start:
                dfs(start,j,path+[j])
    for s in range(n): dfs(s,s,[s])
    ar_bonds=set(); ar_atoms=set()
    seen=set()
    for r in rings:
        key=frozenset(r)
        if key in seen: continue
        seen.add(key)
        ok=True
        for k in range(6):
            a=r[k]; b=r[(k+1)%6]; c=r[(k-1)%6]
            # each atom exactly one ring double bond and one ring single bond, and only C/N in ring (extendable)
            d=(nb[a][b]==2)+(nb[a][c]==2)
            if d!=1 or labels[a][0] not in ('C','N'): ok=False; break
        if ok:
            ar_atoms|=key
            for k in range(6): ar_bonds.add(frozenset((r[k],r[(k+1)%6])))
    labels2=[(el,h,chg, i in ar_atoms) for i,(el,h,chg,ar) in enumerate(labels)]
    adj2=[[(j,'ar' if frozenset((i,j)) in ar_bonds else lab) for j,lab in adj[i]] for i in range(n)]
    return labels2,adj2

def same_kekule_normalised(s1,s2):
    l1,a1=to_graph(s1, keep_aromatic_flag=False); l2,a2=to_graph(s2, keep_aromatic_flag=False)
    l1,a1=perceive_aromatic(l1,a1); l2,a2=perceive_aromatic(l2,a2)
    if wl_hash(l1,a1)[0]!=wl_hash(l2,a2)[0]: return False
    return vf2_iso(l1,a1,l2,a2) is not None

tests=[
 ("benzene aromatic vs kekule","c1ccccc1","C1=CC=CC=C1"),
 ("toluene two kekule forms","CC1=CC=CC=C1","CC1C=CC=CC=1"),
 ("o-xylene kekule form A (double between substituted C's)","CC1=C(C)C=CC=C1","CC1=C(C)C=CC=C1"),
 ("o-xylene kekule A vs B","CC1=C(C)C=CC=C1","CC1C(C)=CC=CC=1"),
 ("aspirin aromatic vs kekule B","CC(=O)Oc1ccccc1C(=O)O","CC(=O)OC1C(C(=O)O)=CC=CC=1"),
 ("salicylic acid two kekule forms","OC(=O)C1=CC=CC=C1O","OC(=O)C1C(O)=CC=CC=1"),
 ("pyridine aromatic vs kekule","c1ccncc1","C1=CC=NC=C1"),
 ("naphthalene aromatic vs kekule","c1ccc2ccccc2c1","C1=CC=C2C=CC=CC2=C1"),
 ("cyclohexa-1,3-diene vs benzene (must differ)","C1=CC=CCC1","c1ccccc1"),
 ("1,3,5-hexatriene vs benzene (must differ)","C=CC=CC=C","c1ccccc1"),
 ("o-xylene vs m-xylene (must differ)","Cc1ccccc1C","Cc1cccc(C)c1"),
 ("o-xylene vs p-xylene (must differ)","Cc1ccccc1C","Cc1ccc(C)cc1"),
]
print(f"{'case':60s} rdkit  naive(kekule-only)  with-aromaticity-perception")
for name,a,b in tests:
    truth=rd_same(a,b)
    l1,a1=to_graph(a,False); l2,a2=to_graph(b,False)
    naive = vf2_iso(l1,a1,l2,a2) is not None
    fixed = same_kekule_normalised(a,b)
    flag = "" if fixed==truth else "   <-- STILL WRONG"
    print(f"{name:60s} {str(truth):6s} {str(naive):18s} {str(fixed):8s}{flag}")
