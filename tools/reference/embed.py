import sys, itertools
from rdkit import Chem
sys.setrecursionlimit(10000)
DIRS=[(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]
def adj(p,q): return sum(abs(a-b) for a,b in zip(p,q))==1
def embed(mol):
    n=mol.GetNumAtoms()
    nb=[[b.GetIdx() for b in a.GetNeighbors()] for a in mol.GetAtoms()]
    # BFS order from atom 0
    order=[0]; seen={0}
    i=0
    while i<len(order):
        for v in nb[order[i]]:
            if v not in seen: seen.add(v); order.append(v)
        i+=1
    pos={}; occ={}
    def ok(v,p):
        if p in occ: return False
        for u,q in pos.items():
            a=adj(p,q); b=(u in nb[v])
            if a!=b: return False
        return True
    def rec(k):
        if k==n: return True
        v=order[k]
        placed=[u for u in nb[v] if u in pos]
        cands=set()
        if not placed: cands={(0,0,0)}
        else:
            q=pos[placed[0]]
            cands={(q[0]+d[0],q[1]+d[1],q[2]+d[2]) for d in DIRS}
        for p in cands:
            if ok(v,p):
                pos[v]=p; occ[p]=v
                if rec(k+1): return True
                del pos[v]; del occ[p]
        return False
    return dict(pos) if rec(0) else None
import re
lines=open(sys.argv[1]).read().splitlines()
for line in lines:
    name,f,smi=line.split('|')
    m=Chem.MolFromSmiles(smi)
    e=embed(m)
    print(("BUILDABLE  " if e else "UNBUILDABLE") , name, smi, "" if e else "<<<<<")
