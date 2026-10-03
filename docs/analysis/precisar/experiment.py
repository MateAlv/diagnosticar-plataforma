"""Rank each real patient with one precise symptom and with its general parent.

  GENES_DB=genes.db PHENOPACKETS_ZIP=all_phenopackets.zip MODEL_URL=http://127.0.0.1:18022 \
    python3 experiment.py 800      # writes results.json

One pair per case: a present term whose direct parent would be offered for
refining replaced by that parent. Seed 7.
"""
import zipfile, json, random, urllib.request, collections, statistics, functools, sys
import metrics as M
import os
URL=os.environ.get('MODEL_URL','http://127.0.0.1:18022')+'/rank-genes'
def rank(terms, gene):
    req=urllib.request.Request(URL, data=json.dumps({'hpo_ids':terms,'top_k':5229}).encode(), headers={'Content-Type':'application/json'})
    try: body=json.load(urllib.request.urlopen(req, timeout=60))
    except Exception as e: return None
    for i,r in enumerate(body['results'],1):
        if r['gene_symbol']==gene: return i
    return None
@functools.lru_cache(None)
def mm(t): return M.m(t)
def offered(r): return r['hijos']>=2 and r['debajo']>=3
z=zipfile.ZipFile(os.environ['PHENOPACKETS_ZIP'])  # phenopacket-store 0.1.27 all_phenopackets.zip
cases=[]
for n in z.namelist():
    if not n.endswith('.json'): continue
    d=json.loads(z.read(n))
    terms=[f['type']['id'] for f in d.get('phenotypicFeatures',[]) if not f.get('excluded')]
    genes={gi['variantInterpretation']['variationDescriptor']['geneContext']['symbol']
           for i in d.get('interpretations',[]) for gi in i.get('diagnosis',{}).get('genomicInterpretations',[])
           if gi.get('variantInterpretation',{}).get('variationDescriptor',{}).get('geneContext')}
    if len(terms)>=3 and len(genes)==1: cases.append((n,terms,genes.pop()))
random.seed(7); random.shuffle(cases)
out=[]
for n,terms,gene in cases:
    if len(out)>=int(sys.argv[1]): break
    # a precise term whose direct parent is a term we would offer to refine
    cand=[(t,p) for t in terms for p in M.parents[t] if M.G.get(p) and offered(mm(p)) and p not in terms]
    if not cand: continue
    t,p=random.choice(cand)
    r0=rank(terms,gene)
    if r0 is None: continue
    r1=rank([p if x==t else x for x in terms],gene)
    if r1 is None: continue
    out.append(dict(case=n,gene=gene,term=t,parent=p,rank_precise=r0,rank_general=r1,**{k:mm(p)[k] for k in ('genes','debajo','hijos','bits')}))
json.dump(out,open('results.json','w'))
print(len(out),'pairs')
