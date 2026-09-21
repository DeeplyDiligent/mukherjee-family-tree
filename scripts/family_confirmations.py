"""Family decisions from the numbered chat answers; no spelling proposals applied.

This is an explicit correction layer over the immutable original tree and CSV.
Questions remain in FOLLOW-UP-QUESTIONS.md, never in the public JSON or UI.
"""
from copy import deepcopy
import re

# Question 12 was deferred. The general marriage convention must not override it.
DEFERRED_CODES = {
    'C/1/1', 'C/5/1', 'C/10/1', 'C/11/1', 'D/3/1', 'D/4/1',
    'D/5/1', 'E/2/1/1', 'E/2/1/2', 'E/2/5/1', 'F/4/4/1', 'G/3/1',
}


def apply_confirmations(nodes, unplaced):
    redirects = {}

    def confirmed(nid):
        if 'Family confirmation' not in nodes[nid]['sources']:
            nodes[nid]['sources'].append('Family confirmation')

    def rename(nid, index, name, nickname=None):
        person = nodes[nid]['members'][index]
        person['name'] = name
        if nickname and nickname not in person['nicknames']:
            person['nicknames'].append(nickname)
        confirmed(nid)

    def combine(target, removed):
        a, b = nodes[target], nodes.pop(removed)
        for key in ('members', 'sourceRecords', 'children'):
            a[key].extend(b[key])
        a['sources'] = list(dict.fromkeys(a['sources'] + b['sources']))
        a['relationship'] = 'couple'
        redirects[removed] = target
        for n in nodes.values():
            n['children'] = list(dict.fromkeys(target if c == removed else c for c in n['children']))
        if removed in unplaced:
            unplaced.remove(removed)
        confirmed(target)

    def family_person(name, gender=None):
        person = {'name': name, 'nicknames': [], 'alternateNames': []}
        if gender:
            person.update(gender=gender, genderSource='Family confirmation')
        return person

    def add_spouse(nid, name):
        n = nodes[nid]
        if not any(m['name'] == name for m in n['members']):
            if len(n['members']) != 1:
                raise ValueError(f'Reconcile existing spouses before adding {name} to {nid}')
            n['members'].append(family_person(name))
        n['relationship'] = 'couple'
        n['lineageMemberIndex'] = 0
        confirmed(nid)

    def add_child(nid, parent_id, members):
        if nid in nodes:
            raise ValueError('Duplicate family-confirmed entry: ' + nid)
        nodes[nid] = {
            'id': nid, 'code': '', 'members': members,
            'relationship': 'couple' if len(members) == 2 else 'individual',
            'lineageMemberIndex': 0, 'children': [],
            'sources': ['Family confirmation'], 'sourceRecords': [], 'notes': [],
        }
        nodes[parent_id]['children'].append(nid)
        confirmed(parent_id)

    # Additional B/2 families supplied directly by the family. Source codes
    # remain blank for new people, and namesakes in other branches stay separate.
    add_spouse('CSV_B_2_3', 'Srabani Roychoudhury')
    add_child('FAMILY_B_2_3_ORKOJEET', 'CSV_B_2_3', [family_person('Orkojeet Banerjee', 'male')])
    add_spouse('CSV_B_2_1', 'Malabika Banerjee')
    add_child('FAMILY_B_2_1_ANUSHKA', 'CSV_B_2_1', [family_person('Anushka Banerjee')])
    add_child('FAMILY_B_2_1_ARJIT', 'CSV_B_2_1', [family_person('Arjit Banerjee'), family_person('Anusha Rajah')])
    add_child('FAMILY_B_2_1_ARJIT_JAI', 'FAMILY_B_2_1_ARJIT', [family_person('Jai Banerjee')])
    add_child('FAMILY_B_2_1_ARJIT_MAYA', 'FAMILY_B_2_1_ARJIT', [family_person('Maya Banerjee')])

    # Primary spellings remain those in the existing tree (answer 24).
    rename('F1_1', 1, 'Debesh Mukherjee', 'Debu')
    rename('F1_1', 0, 'Smt. Bulla Mukherjee', 'Buli')
    rename('F1_4b', 0, 'Smt. Elora Chakraborty', 'Pinku')
    rename('F2_3', 1, 'Jayanta Mukherjee', 'Totan')
    rename('F5_1a', 0, 'Smt. Ria Chatterjee')
    rename('F4_1', 0, 'Smt. Sumita Chatterjee', 'Keya')

    # Full names explicitly accepted in answer 23; do not invent surname changes.
    rename('F1_3', 0, 'Smt. Mamata Banerjee')
    rename('F1_3', 1, 'Chandra Sekhar Banerjee')
    rename('F5', 1, 'Durga Prasad Chatterjee')
    rename('G2', 1, 'Sunil Kumar Banerjee')
    rename('G1_2', 0, 'Shaymal Banerjee')
    rename('G1_1b', 0, 'Kalpna Banerjee')
    rename('G1_2b', 0, 'Rina Banerjee')
    rename('F4_4b', 0, 'Dola Mukherjee')
    rename('F5_2b', 0, 'Arnab Roychowdhury')

    # All seven slash forms in question 17 are confirmed nicknames.
    for nid in ('CSV_A_4_3_1', 'CSV_A_4_3_2', 'E2_Va', 'G1_1b', 'G1_2b', 'G1_3', 'CSV_G_3_1'):
        person = nodes[nid]['members'][0]
        person['nicknames'] = list(dict.fromkeys(person['nicknames'] + person['alternateNames']))
        person['alternateNames'] = []
        confirmed(nid)

    # Pankoj is kept as written. R. T. Martin is a recorded alternate, not a
    # fabricated spouse, a confirmed nickname, or a claim of legal name change.
    person = nodes['CSV_A_3_2']['members'][0]
    person['name'] = 'Pankoj'
    person['alternateNames'] = ['R. T. Martin']

    combine('G1_1', 'G1_1b')
    combine('G1_2', 'G1_2b')
    for cid in ('CSV_G_1_2_1', 'CSV_G_1_2_2'):
        nodes['G1_2']['children'].append(cid)
        unplaced.remove(cid)
        confirmed(cid)

    # Family-confirmed C/6 children. Stable IDs and original blank CSV codes
    # are retained so old links and source records remain intact.
    combine('UNPLACED_146', 'UNPLACED_147')
    for cid in ('UNPLACED_144', 'UNPLACED_145', 'UNPLACED_146', 'UNPLACED_148'):
        nodes['CSV_C_6']['children'].append(cid)
        unplaced.remove(cid)
        nodes[cid]['lineageMemberIndex'] = 0
        confirmed(cid)
    confirmed('CSV_C_6')

    # Daliip and Dalia are spouses; Abhishek is their child, not a third spouse.
    parent = nodes['CSV_E_2_4']
    child = deepcopy(parent)
    child.update(id='CSV_E_2_4_ABHISHEK', code='', relationship='individual', children=[])
    child['members'] = [parent['members'].pop(2)]
    child['sourceRecords'] = [r for r in parent['sourceRecords'] if r['name'] == 'ABHISHEK MUKHERJEE']
    parent['sourceRecords'] = [r for r in parent['sourceRecords'] if r['name'] != 'ABHISHEK MUKHERJEE']
    nodes[child['id']] = child
    parent['children'].append(child['id'])
    parent['relationship'] = 'couple'
    confirmed(parent['id'])
    confirmed(child['id'])

    nodes['PARENT']['relationship'] = 'couple'
    confirmed('PARENT')
    for nid in ('G2_1', 'G2_2', 'G2_3', 'G2_4', 'CSV_D_2_2'):
        confirmed(nid)

    for n in nodes.values():
        if n['relationship'] == 'register':
            # Apply the user's general convention, except explicitly deferred
            # groups. This is guidance, not name/gender-based inference.
            if len(n['members']) == 2 and n['code'] not in DEFERRED_CODES:
                n['relationship'] = 'couple'
                n['sources'].append('Family guidance on register codes')
            else:
                n['relationship'] = 'group' if len(n['members']) > 1 else 'individual'
        if n['relationship'] == 'uncertain':
            n['relationship'] = 'group'

    # Source-identified and family-confirmed descendants precede their spouse.
    # Member objects move together with their names, nicknames and gender evidence.
    line_first = {
        'F1': 'Ganesh Mukherjee', 'F2': 'Bhabesh Mukherjee',
        'F1_1': 'Debesh Mukherjee', 'F2_1': 'Samaresh Mukherjee',
        'F2_2': 'Vikram Mukherjee', 'F2_3': 'Jayanta Mukherjee',
        'F4_1': 'Sankar Chatterjee', 'F5_1': 'Goutam Chatterjee',
        'E2_III': 'Mihir Mukherjee',
    }
    confirmed_line_first = {
        'F1_1b': 'Debankur Mukherjee',
        'F2_1a': 'Smt. Shabarna Mukherjee',
        'F2_1b': 'Smt. Srijata Chowdhury',
        'F2_2a': 'Smt. Upasana Mitra',
        'F2_3a': 'Smt. Bedatrayee Kurian',
        'F4_1a': 'Somdev Chattopadhyay',
    }
    line_first.update(confirmed_line_first)
    for nid, name in line_first.items():
        if sum(m['name'] == name for m in nodes[nid]['members']) != 1:
            raise ValueError(f'Expected one lineage member {name} in {nid}')
        nodes[nid]['members'].sort(key=lambda m: m['name'] != name)
        nodes[nid]['lineageMemberIndex'] = 0
        if nid in confirmed_line_first:
            confirmed(nid)

    # Explicit family clarification, not an inference from a leaf node.
    if nodes['F2_2a']['children']:
        raise ValueError('Reconcile newly recorded children with the family clarification for Upasana/Kaushik')
    nodes['F2_2a']['childrenStatus'] = 'none'
    confirmed('F2_2a')

    # Public data contains names and sources, not the private question log.
    for n in nodes.values():
        n['notes'] = ['Closed branch (as recorded in the original tree).'] if n['id'] in ('F3', 'F6') else []
        n.pop('reviewIds', None)
        # An unknown spouse remains a private data question, not a placeholder
        # "person" rendered in the tree. Their existence isn't inferred afresh.
        n['members'] = [m for m in n['members'] if m['name'] != 'Name not recorded']
        for person in n['members']:
            # The exact source text still includes titles. Main names use the
            # approved gender symbols instead, without changing spelling.
            person['name'] = re.sub(r'^(?:Smt|Miss)\b\s*\.?\s*', '', person['name'], flags=re.IGNORECASE)
        if len(n['members']) == 1 and n['relationship'] == 'couple':
            n['relationship'] = 'individual'
    return redirects
