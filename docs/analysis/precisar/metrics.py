"""Per-term metrics for deciding when to offer "Precisar" (docs/PRECISAR_SINTOMAS.md).

  GENES_DB=path/to/genes.db python3 metrics.py HP:0001250 HP:0000767

genes: genes the term reaches; hijos / debajo: terms directly / anywhere
beneath that reach a gene; mediana_hijo / mayor_hijo: share of the term's
genes the median / largest child keeps; bits: log2(1 / mediana_hijo);
sin_tipo: share of its genes annotated at no child.
"""
import sqlite3, collections, functools, sys, math, json, statistics
sys.setrecursionlimit(100000)
import os
DB=os.environ.get('GENES_DB','genes.db')  # a genes.db with the term tree (add_term_tree.py)
db=sqlite3.connect(DB)
name=dict(db.execute('select hpo_id,nombre from hpo_terminos'))
kids=collections.defaultdict(list); parents=collections.defaultdict(list)
for p,c in db.execute('select padre,hijo from hpo_hijos'): kids[p].append(c); parents[c].append(p)
@functools.lru_cache(None)
def anc(t):
    s=set()
    for p in parents[t]: s.add(p); s|=anc(p)
    return frozenset(s)
dis=collections.defaultdict(set)
for omim,h in db.execute('select omim,hpo_id from sintomas_esperados'): dis[omim].add(h)
G=collections.defaultdict(set)
for sym,codes in db.execute('select simbolo,codigo_omim from genes'):
    for o in json.loads(codes or '[]'):
        for t in dis.get(str(o),()):
            G[t].add(sym)
            for a in anc(t): G[a].add(sym)
@functools.lru_cache(None)
def desc(t):
    s=set()
    for c in kids[t]: s.add(c); s|=desc(c)
    return frozenset(s)
def m(t):
    n=len(G[t]); ck=[c for c in kids[t] if G[c]]
    d=sum(1 for x in desc(t) if G[x])
    if ck and n:
        shares=[len(G[c])/n for c in ck]
        med=statistics.median(shares); top=max(shares)
        union=set().union(*(G[c] for c in ck)); only_here=n-len(union)
    else: med=top=None; only_here=n
    gain=math.log2(1/med) if med else 0
    return dict(id=t,nombre=name.get(t,'?'),genes=n,hijos=len(ck),debajo=d,
                mediana_hijo=round(med,3) if med else None,mayor_hijo=round(top,3) if top else None,
                bits=round(gain,2),sin_tipo=round(only_here/n,2) if n else None)
if __name__=='__main__':
    for t in sys.argv[1:]: print(json.dumps(m(t),ensure_ascii=False))
