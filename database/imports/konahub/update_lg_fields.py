"""Update vendita_contratti.numero_contratto_energia/pod_pdr/ex_fornitore
dai dati del foglio CHECK_L&G konahub (righe >= 01/01/26).
Match: cf_piva + tipo (Luce/Gas dedotto da POD) + data (finestra +/-30gg).
Aggiorna solo se il campo e' NULL (safety per righe gia' modificate manualmente).
"""
import csv, json, os, re, subprocess, sys, argparse
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path('/Users/mirkopiasenti/Desktop/MIROX_COMPLETO')
BIN = ROOT / '.bin/supabase'
CSV_PATH = Path("/Users/mirkopiasenti/Downloads/CRM - E.P.M. - CHECK_L&G.csv")

def dbq(sql, t=180):
    r = subprocess.run([str(BIN),'db','query','--linked',sql], capture_output=True, text=True, timeout=t, cwd=str(ROOT))
    if r.returncode != 0:
        raise RuntimeError(r.stderr[:300])
    o = r.stdout
    return json.loads(o[o.find('{'):o.rfind('}')+1])

def parse_date_it(s):
    if not s: return None
    s = s.strip()
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2,4})$', s)
    if not m: return None
    d, mo, y = int(m.group(1)), int(m.group(2)), m.group(3)
    if len(y) == 2: y = int('20'+y)
    else: y = int(y)
    try:
        return datetime(y, mo, d).date()
    except ValueError:
        return None

def cf_norm(s):
    if not s: return None
    v = s.strip().upper()
    if re.fullmatch(r'\d{10}', v): v = '0' + v
    return v or None

def detect_tipo(pod):
    """POD elettrico solitamente inizia con 'IT' (case-insens). PDR gas e' numerico."""
    if not pod: return None
    p = pod.strip().upper()
    if p.startswith('IT'): return 'Luce'
    if re.match(r'^\d+', p): return 'Gas'
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--execute', action='store_true')
    args = ap.parse_args()

    # Carica contratti Energia 2026 con campi ancora NULL
    r = dbq("""SELECT vc.id, vc.data_contratto::date AS day, vc.nome_offerta_snapshot AS tipo,
                      vc.numero_contratto_energia, vc.pod_pdr, vc.ex_fornitore,
                      a.cf_piva
               FROM vendita_contratti vc
               JOIN anagrafica a ON a.id = vc.anagrafica_id
               WHERE vc.categoria_snapshot='Energia' AND vc.data_contratto >= '2026-01-01';""", t=120)
    contratti = r['rows']
    # index per (cf, tipo) -> lista contratti ordinati per data
    idx = defaultdict(list)
    for c in contratti:
        cf = cf_norm(c['cf_piva'])
        if cf:
            idx[(cf, c['tipo'])].append(c)
    for k in idx: idx[k].sort(key=lambda x: x['day'])

    # Parse CSV
    with open(CSV_PATH, encoding='utf-8') as f:
        rows = list(csv.reader(f))
    header = [h.strip() for h in rows[0]]
    col = {h: i for i, h in enumerate(header)}
    data = rows[1:]

    matched = []
    ambiguous = []  # match multiplo
    unmatched = []
    dup_used = defaultdict(int)  # (cf,tipo) -> quanti gia' usati

    for r in data:
        df = parse_date_it(r[col['DATA FIRMA']])
        if not df or df.year < 2026: continue
        cf = cf_norm(r[col['C.F. o P.IVA']])
        pod = r[col['POD o PDR']].strip()
        tipo = detect_tipo(pod)
        if not cf or not tipo:
            unmatched.append((r[col['RAGIONE SOCIALE']], 'no-cf-o-tipo'))
            continue
        cands = idx.get((cf, tipo), [])
        if not cands:
            unmatched.append((r[col['RAGIONE SOCIALE']], f'no-contratto-{tipo}'))
            continue
        # filtra per data +/-30gg
        target = df
        cands_win = [c for c in cands if abs((datetime.strptime(c['day'],'%Y-%m-%d').date() - target).days) <= 30]
        if not cands_win:
            unmatched.append((r[col['RAGIONE SOCIALE']], f'data-fuori-30gg-{tipo}'))
            continue
        # pick il piu' vicino non ancora usato per lo stesso cliente
        key = (cf, tipo)
        used = dup_used[key]
        if used >= len(cands_win):
            # ci sono piu' righe CSV che contratti DB per stesso cliente+tipo -> ambigue
            ambiguous.append((r[col['RAGIONE SOCIALE']], tipo, len(cands_win), used+1))
            continue
        chosen = sorted(cands_win, key=lambda c: abs((datetime.strptime(c['day'],'%Y-%m-%d').date() - target).days))[used]
        dup_used[key] += 1
        matched.append({
            'id': chosen['id'],
            'numero_contratto': r[col['CODICE CONTRATTO']].strip() or None,
            'pod_pdr': pod or None,
            'ex_fornitore': r[col['EX FORNITORE']].strip() or None,
            'tipo': tipo,
            'cf': cf,
        })

    print(f"CSV righe 2026 valide: {sum(1 for r in data if (parse_date_it(r[col['DATA FIRMA']]) or datetime(2000,1,1).date()).year>=2026)}")
    print(f"Matched: {len(matched)}")
    print(f"Ambigue (piu righe CSV che contratti DB per cf+tipo): {len(ambiguous)}")
    print(f"Unmatched: {len(unmatched)}")
    if unmatched[:8]:
        print("Sample unmatched:")
        for n, w in unmatched[:8]: print(f"  [{w}] {n}")
    if ambiguous[:5]:
        print("Sample ambigue:")
        for n, t, c, u in ambiguous[:5]: print(f"  {n} {t}: {u} vs {c} contratti")

    if not args.execute:
        return

    # Batch UPDATE via VALUES + COALESCE (non sovrascrive gia' compilati manualmente)
    BATCH = 100
    updated = 0
    for i in range(0, len(matched), BATCH):
        sub = matched[i:i+BATCH]
        vals = []
        for m in sub:
            num = ("'" + m['numero_contratto'].replace("'", "''") + "'") if m['numero_contratto'] else 'NULL'
            pod = ("'" + m['pod_pdr'].replace("'", "''") + "'") if m['pod_pdr'] else 'NULL'
            exf = ("'" + m['ex_fornitore'].replace("'", "''") + "'") if m['ex_fornitore'] else 'NULL'
            vals.append(f"('{m['id']}'::uuid, {num}, {pod}, {exf})")
        sql = ("UPDATE vendita_contratti vc SET "
               "numero_contratto_energia = COALESCE(vc.numero_contratto_energia, v.num), "
               "pod_pdr = COALESCE(vc.pod_pdr, v.pod), "
               "ex_fornitore = COALESCE(vc.ex_fornitore, v.exf), "
               "updated_at = NOW() "
               "FROM (VALUES " + ', '.join(vals) + ") AS v(id, num, pod, exf) "
               "WHERE vc.id = v.id::uuid;")
        dbq(sql, t=120)
        updated += len(sub)
        print(f"  updated {updated}/{len(matched)}")

if __name__ == '__main__':
    main()
