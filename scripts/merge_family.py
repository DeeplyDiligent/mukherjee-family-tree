#!/usr/bin/env python3
"""Rebuild the public family tree from immutable sources and explicit decisions.

Every CSV name retains its source row, column, category and spelling. Family
confirmations are applied separately. Private questions are never published.
"""
import csv
import json
import re
from collections import defaultdict
from pathlib import Path

from family_confirmations import apply_confirmations

ROOT = Path(__file__).resolve().parents[1]
CSV_FILE = ROOT / 'PKM SIR FAMILY TYPING.csv'

MAPPING = {
    'F': 'SUHASI', 'G': 'LABANYA',
    'F/1': 'F1', 'F/2': 'F2', 'F/3': 'F3', 'F/4': 'F4', 'F/5': 'F5', 'F/6': 'F6',
    'F/1/1': 'F1_1', 'F/1/2': 'F1_2', 'F/1/3': 'F1_3', 'F/1/4': 'F1_4',
    'F/1/1/1': 'F1_1a', 'F/1/1/2': 'F1_1a',
    'F/1/2/1': 'F1_2a', 'F/1/2/2': 'F1_2b',
    'F/1/4/1': 'F1_4a', 'F/1/4/2': 'F1_4b',
    'F/2/1': 'F2_1', 'F/2/2': 'F2_2', 'F/2/3': 'F2_3',
    'F/4/1': 'F4_1', 'F/4/2': 'F4_2', 'F/4/3': 'F4_3', 'F/4/4': 'F4_4',
    'F/4/2/1': 'F4_2a', 'F/4/2/2': 'F4_2b', 'F/4/2/3': 'F4_2c',
    'F/4/3/1': 'F4_3a', 'F/4/4/1': 'F4_4a',
    'F/5/1': 'F5_1', 'F/5/2': 'F5_2', 'F/5/1/1': 'F5_1a',
    'F/5/2/1': 'F5_2a', 'F/5/2/2': 'F5_2b',
    'G/1': 'G1', 'G/2': 'G2', 'G/1/1': 'G1_1', 'G/1/2': 'G1_2', 'G/1/3': 'G1_3',
    'G/2/1': 'G2_1', 'G/2/2': 'G2_4',
    'E/2/3': 'E2_III', 'E/2/3/1': 'E2_IIIa',
    'E/2/5': 'E2_V', 'E/2/5/1': 'E2_Va',
}
ROW_OVERRIDES = {
    ('G/1/1', 'KALPANA/ RUBY BANERJEE'): 'G1_1b',
    ('G/1/2', 'RINA / CHABI BANERJEE'): 'G1_2b',
    ('G/2/1', 'DIPANKAR BANERJEE'): 'G2_2',
    ('G/2/1', 'SHUVANKAR BANERJEE'): 'G2_3',
    ('F/4/4/1', 'DOLA MUKHERJEE'): 'F4_4b',
    ('E/2/5/1', 'DEBOJYOTY BHATTACHARJEE'): 'CSV_E_2_5_1_EXTRA',
}


def pretty(name):
    return re.sub(r'\b(Smt|Miss)\s*\.?\s+', lambda m: m[1] + '. ', name.strip().title())


def member(name, surname=''):
    parts = [p.strip() for p in name.split('/')]
    if len(parts) > 1 and not surname:
        words = parts[-1].split()
        if len(words) > 1:
            surname = words[-1]
            parts[-1] = ' '.join(words[:-1])

    def full(part):
        if part in ('Smt.', 'Smt'):
            return 'Name not recorded'
        return part + (' ' + surname if surname and not part.lower().endswith(surname.lower()) else '')

    person = {'name': full(parts[0]), 'nicknames': [], 'alternateNames': parts[1:]}
    # Titles are recorded evidence; bare names never determine gender.
    if re.match(r'^(?:Smt|Miss)\b', name, re.IGNORECASE):
        person.update(gender='female', genderSource='Recorded honorific')
    return person


def merge():
    original = json.loads((ROOT / 'data/family-data.original.json').read_text())
    nodes = {}
    for old in original['nodes']:
        n = {
            'id': old['id'], 'code': old.get('branchCode', old.get('branch', '')),
            'members': [member(s, old.get('surname', '')) for s in old.get('couple', [old.get('name', old.get('title', ''))])],
            'relationship': 'couple' if 'couple' in old else 'individual',
            'children': [c if isinstance(c, str) else c['id'] for c in old.get('children', [])],
            'sources': ['Existing tree'], 'sourceRecords': [], 'notes': [],
        }
        if 'couple' in old:
            # The original renderer explicitly interprets this array as
            # [wife, husband]. This does not resolve disputed relationships.
            n['members'][0].update(gender='female', genderSource='Original wife role')
            n['members'][1].update(gender='male', genderSource='Original husband role')
        nodes[n['id']] = n
    root = nodes['PARENT']
    root.update(members=[member('Aditya Ch. Banerjee'), member('Smt. Sarla Debi')], relationship='couple', children=[])
    nodes['F1_1a']['relationship'] = 'group'
    nodes['F1_1a']['members'][0]['name'] = 'Minakshi Mukherjee'

    records = []
    with CSV_FILE.open(newline='', encoding='utf-8-sig') as f:
        for rownum, row in enumerate(csv.reader(f), 1):
            for col in (0, 2):
                if len(row) <= col or not row[col].strip():
                    continue
                name = row[col].strip()
                if name in ('NAME', 'ADITYA BANERJEE & FAMILY'):
                    continue
                code = row[col + 1].strip() if len(row) > col + 1 else ''
                records.append({'name': name, 'code': code, 'row': rownum, 'column': col + 1})

    code_nodes = defaultdict(list)
    unplaced = []
    for rec in records:
        code, name = rec['code'], rec['name']
        if not code:
            nid = 'PARENT' if rec['row'] in (3, 4) else 'UNPLACED_' + str(rec['row'])
        else:
            nid = ROW_OVERRIDES.get((code, name), MAPPING.get(code, 'CSV_' + code.replace('/', '_')))
        if nid not in nodes:
            nodes[nid] = {
                'id': nid, 'code': code, 'members': [], 'relationship': 'register',
                'children': [], 'sources': [], 'sourceRecords': [], 'notes': [],
            }
        n = nodes[nid]
        if nid.startswith(('CSV_', 'UNPLACED_')):
            n['members'].append(member(pretty(name)))
        if 'CSV register' not in n['sources']:
            n['sources'].append('CSV register')
        n['sourceRecords'].append(rec)
        if code:
            n['code'] = code if nid != 'F1_1a' else 'F/1/1/1 + F/1/1/2'
            if nid not in code_nodes[code]:
                code_nodes[code].append(nid)
        elif nid != 'PARENT':
            unplaced.append(nid)

    parents = {c: n['id'] for n in nodes.values() for c in n['children']}
    for code, ids in code_nodes.items():
        if '/' not in code:
            root['children'].extend(ids)
            continue
        candidates = code_nodes.get(code.rsplit('/', 1)[0], [])
        for nid in ids:
            if nid in parents:
                continue
            if len(candidates) != 1:
                if nid not in unplaced:
                    unplaced.append(nid)
                continue
            parent_id = candidates[0]
            nodes[parent_id]['children'].append(nid)
            parents[nid] = parent_id

    redirects = apply_confirmations(nodes, unplaced)
    row_order = {nid: min((r['row'] for r in n['sourceRecords']), default=10000) for nid, n in nodes.items()}
    for n in nodes.values():
        n['children'] = sorted(set(n['children']), key=lambda nid: (row_order[nid], nid))
        n['branch'] = next((r['code'][0] for r in n['sourceRecords'] if r['code']), '')

    seen = set()
    def inherit(nid, branch=''):
        if nid in seen:
            raise ValueError('Cycle or duplicate parent: ' + nid)
        seen.add(nid)
        n = nodes[nid]
        n['branch'] = n['branch'] or branch
        for child in n['children']:
            inherit(child, n['branch'])
    for rid in ['PARENT', *unplaced]:
        inherit(rid)
    if seen != set(nodes):
        raise ValueError('Unreachable family entries')

    data = {
        'schemaVersion': 3, 'rootId': 'PARENT', 'unplacedIds': unplaced,
        'idRedirects': redirects, 'sourceFile': CSV_FILE.name,
        'summary': {'csvNameEntries': len(records), 'originalNodes': len(original['nodes']), 'familyEntries': len(nodes)},
        'nodes': list(nodes.values()),
    }
    destination = ROOT / 'family-data.json'
    temporary = destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(destination)
    (ROOT / 'MERGE-REVIEW.md').write_text(
        '# Family data update\n\n'
        'The original CSV and original-tree snapshot are unchanged. All 289 CSV name records '
        'retain their source spelling, code, row and column. Existing descendants remain; '
        'merged spouse entries have legacy-ID redirects.\n\n'
        'Confirmed changes are applied in `scripts/family_confirmations.py`: nicknames, '
        'Ria Chatterjee’s retained surname, the G/1 couples and their children, '
        'Daliip/Dalia/Abhishek, Bina/Barun’s children Sankar, Bapi, Doli and Buri '
        '(with Mrinal as Doli’s spouse), Amajit/Srabani/Orkojeet and '
        'Avijit/Malabika/Anushka/Arjit/Anusha/Jai/Maya, and approved full names. Existing spellings '
        'take precedence. No proposed spelling corrections have been applied. Approved '
        'gender symbols replace display honorifics where explicit family information, '
        'source titles or original spouse roles provide evidence; bare names do not determine gender.\n\n'
        'The website defaults to the collapsed A–G diagram, with branch heads visible. Names follow the family '
        'line first using source information and family confirmations. Debankur, Shabarna, '
        'Srijata, Upasana, Bedatrayee and Somdev are confirmed descendants and precede '
        'their spouses; their children remain unchanged.\n\n'
        'Outstanding questions are maintained in `FOLLOW-UP-QUESTIONS.md`, which is not '
        'served by the LAN preview and is not rendered by the website.\n'
    )
    print(f'Merged {len(records)} CSV records into {len(nodes)} entries; {len(redirects)} legacy-ID redirects.')


if __name__ == '__main__':
    merge()
