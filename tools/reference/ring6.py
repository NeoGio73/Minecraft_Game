# enumerate induced 6-cycles in Z^3 starting at origin; classify up to symmetry by whether planar
import itertools
DIRS=[(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]
def add(p,d): return tuple(a+b for a,b in zip(p,d))
def adj(p,q): return sum(abs(a-b) for a,b in zip(p,q))==1
found=set()
def rec(path):
    if len(path)==6:
        if adj(path[-1],path[0]):
            # induced check: only consecutive pairs adjacent
            ok=True
            for i in range(6):
                for j in range(i+2,6):
                    if (i,j)==(0,5): continue
                    if adj(path[i],path[j]): ok=False
            if ok:
                planar = any(len({p[k] for p in path})==1 for k in range(3))
                found.add(("planar" if planar else "skew"))
        return
    for d in DIRS:
        q=add(path[-1],d)
        if q in path: continue
        rec(path+[q])
rec([(0,0,0)])
print("induced 6-cycle types found:", found)
