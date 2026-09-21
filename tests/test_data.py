import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class FamilyDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((ROOT / 'family-data.json').read_text())
        cls.nodes = {n['id']: n for n in cls.data['nodes']}

    def person(self, nid, name):
        return next(m for m in self.nodes[nid]['members'] if m['name'] == name.removeprefix('Smt. '))

    def test_no_source_metadata_anywhere_in_data(self):
        forbidden = {'sources', 'sourceRecords', 'sourceFile', 'genderSource',
                     'csvNameEntries', 'originalNodes', 'row', 'column'}

        def check(value):
            if isinstance(value, dict):
                self.assertFalse(forbidden.intersection(value))
                for child in value.values():
                    check(child)
            elif isinstance(value, list):
                for child in value:
                    check(child)

        check(self.data)
        text = json.dumps(self.data)
        for label in ('Existing tree', 'CSV register', 'Family confirmation', 'original tree'):
            self.assertNotIn(label, text)

    def test_legacy_redirects_and_later_descendants(self):
        for old_id, target in self.data['idRedirects'].items():
            self.assertNotIn(old_id, self.nodes)
            self.assertIn(target, self.nodes)
        for nid in ['F1_1b1', 'F2_1b1', 'F2_1b2', 'F2_3a1', 'F1_4b1', 'F4_1a1']:
            self.assertIn(nid, self.nodes)

    def test_graph_integrity_and_branches(self):
        self.assertEqual(len(self.nodes), len(self.data['nodes']))
        seen = set()
        def visit(nid):
            self.assertNotIn(nid, seen)
            seen.add(nid)
            for child in self.nodes[nid]['children']:
                visit(child)
        for rid in [self.data['rootId'], *self.data['unplacedIds']]:
            visit(rid)
        self.assertEqual(seen, set(self.nodes))
        self.assertEqual([self.nodes[n]['branch'] for n in self.nodes['PARENT']['children']], list('ABCDEFG'))
        self.assertEqual(self.nodes['E2_III']['branch'], 'E')

    def test_confirmed_nicknames_and_existing_spellings(self):
        for nid, name, nickname in [
            ('F4_1', 'Smt. Sumita Chatterjee', 'Keya'),
            ('F1_1', 'Debesh Mukherjee', 'Debu'),
            ('F1_1', 'Smt. Bulla Mukherjee', 'Buli'),
            ('F1_4b', 'Smt. Elora Chakraborty', 'Pinku'),
            ('F2_3', 'Jayanta Mukherjee', 'Totan'),
            ('G1_1', 'Kalpna Banerjee', 'Ruby'),
            ('G1_2', 'Rina Banerjee', 'Chabi'),
            ('G1_3', 'Smt. Rita Mukherjee', 'Tushi'),
            ('E2_Va', 'Nilanjan Bhattacherjee', 'Diltoo'),
            ('CSV_A_4_3_1', 'Manash Chatterjee', 'Munmun'),
            ('CSV_A_4_3_2', 'Rupa Chatterjee', 'Tuntun'),
            ('CSV_G_3_1', 'Somnath Banerjee', 'Bappi'),
        ]:
            self.assertIn(nickname, self.person(nid, name)['nicknames'])

    def test_ria_keeps_her_surname(self):
        self.assertEqual([m['name'] for m in self.nodes['F5_1a']['members']], ['Ria Chatterjee', 'Deep Bhattacharyya'])

    def test_confirmed_spouses_and_children(self):
        for nid in ('G1_1', 'G1_2', 'UNPLACED_146', 'CSV_E_2_4'):
            self.assertEqual(self.nodes[nid]['relationship'], 'couple')
            self.assertEqual(len(self.nodes[nid]['members']), 2)
        self.assertEqual(set(self.nodes['G1_2']['children']), {'CSV_G_1_2_1', 'CSV_G_1_2_2'})
        self.assertEqual(self.nodes['CSV_E_2_4']['children'], ['CSV_E_2_4_ABHISHEK'])
        self.assertEqual(self.nodes['CSV_E_2_4_ABHISHEK']['members'][0]['name'], 'Abhishek Mukherjee')

    def test_deferred_relationships_are_not_overwritten_by_general_rule(self):
        for nid in ('F1_1a', 'CSV_C_1_1', 'CSV_C_5_1', 'CSV_C_10_1', 'CSV_C_11_1', 'CSV_D_3_1', 'CSV_D_4_1', 'CSV_D_5_1', 'CSV_E_2_1_1', 'CSV_E_2_1_2', 'CSV_G_3_1'):
            self.assertEqual(self.nodes[nid]['relationship'], 'group')
        self.assertEqual(self.nodes['CSV_A_1']['relationship'], 'couple')
        self.assertIn('CSV_E_2_5_1_EXTRA', self.nodes['E2_V']['children'])
        self.assertEqual(self.data['unplacedIds'], [])

    def test_bina_barun_children_and_doli_spouse_are_connected(self):
        children = ['UNPLACED_144', 'UNPLACED_145', 'UNPLACED_146', 'UNPLACED_148']
        self.assertEqual(self.nodes['CSV_C_6']['children'], children)
        for nid in children:
            self.assertEqual(self.nodes[nid]['branch'], 'C')
            self.assertEqual(self.nodes[nid]['lineageMemberIndex'], 0)
            self.assertEqual(self.nodes[nid]['code'], '')
        self.assertEqual([m['name'] for m in self.nodes['UNPLACED_146']['members']], ['Doli Banerjee', 'Mrinal Banerjee'])
        self.assertEqual(self.nodes['UNPLACED_146']['relationship'], 'couple')
        self.assertEqual(self.data['idRedirects']['UNPLACED_147'], 'UNPLACED_146')
        questions = ROOT / 'FOLLOW-UP-QUESTIONS.md'
        if questions.exists():
            self.assertNotIn('**Q15:**', questions.read_text())

    def test_confirmed_b2_families_preserve_names_and_parentage(self):
        expected = {
            'CSV_B_2_3': (['Amajit Banerjee', 'Srabani Roychoudhury'], ['FAMILY_B_2_3_ORKOJEET']),
            'CSV_B_2_1': (['Avijit Banerjee', 'Malabika Banerjee'], ['FAMILY_B_2_1_ANUSHKA', 'FAMILY_B_2_1_ARJIT']),
            'FAMILY_B_2_1_ARJIT': (['Arjit Banerjee', 'Anusha Rajah'], ['FAMILY_B_2_1_ARJIT_JAI', 'FAMILY_B_2_1_ARJIT_MAYA']),
            'FAMILY_B_2_3_ORKOJEET': (['Orkojeet Banerjee'], []),
            'FAMILY_B_2_1_ANUSHKA': (['Anushka Banerjee'], []),
            'FAMILY_B_2_1_ARJIT_JAI': (['Jai Banerjee'], []),
            'FAMILY_B_2_1_ARJIT_MAYA': (['Maya Banerjee'], []),
        }
        for nid, (names, children) in expected.items():
            n = self.nodes[nid]
            self.assertEqual([m['name'] for m in n['members']], names)
            self.assertEqual(n['children'], children)
            self.assertEqual(n['branch'], 'B')
            self.assertEqual(n['lineageMemberIndex'], 0)
            self.assertEqual(n['relationship'], 'couple' if len(names) == 2 else 'individual')
            if nid.startswith('FAMILY_'):
                self.assertEqual(n['code'], '')
        self.assertEqual(self.nodes['CSV_B_2']['children'][:3], ['CSV_B_2_1', 'CSV_B_2_2', 'CSV_B_2_3'])
        self.assertEqual(self.person('FAMILY_B_2_3_ORKOJEET', 'Orkojeet Banerjee')['gender'], 'male')
        self.assertNotIn('gender', self.nodes['FAMILY_B_2_1_ARJIT_JAI']['members'][0])
        self.assertEqual(self.nodes['FAMILY_B_2_1_ARJIT_MAYA']['members'][0]['gender'], 'female')
        self.assertEqual(self.nodes['FAMILY_B_2_1_ANUSHKA']['members'][0]['gender'], 'female')
        self.assertEqual(sum(len(n['members']) for n in self.nodes.values()), 322)
        self.assertEqual(len(self.nodes), 209)
        # The new Malabika is not merged with the namesake married to Bibek.
        self.assertIn('Malabika Banerjee', [m['name'] for m in self.nodes['CSV_A_1_2']['members']])

    def test_lineage_first(self):
        for nid, name in [('F1', 'Ganesh Mukherjee'), ('F2', 'Bhabesh Mukherjee'), ('F1_1', 'Debesh Mukherjee'), ('F4_1', 'Sankar Chatterjee'), ('F1_4b', 'Smt. Elora Chakraborty'), ('CSV_D_2_2', 'Smt. Aparna Chatterjee')]:
            self.assertEqual(self.nodes[nid]['members'][0]['name'], name.removeprefix('Smt. '))

    def test_six_confirmed_lineage_members_and_descendants(self):
        cases = [
            ('F1_1b', 'F1_1', ['Debankur Mukherjee', 'Swagata Mukherjee'], ['F1_1b1']),
            ('F2_1a', 'F2_1', ['Shabarna Mukherjee', 'Supriyo Mukherjee'], ['F2_1a1']),
            ('F2_1b', 'F2_1', ['Srijata Chowdhury', 'Arijit Chowdhury'], ['F2_1b1', 'F2_1b2']),
            ('F2_2a', 'F2_2', ['Upasana Mitra', 'Kaushik Mitra'], []),
            ('F2_3a', 'F2_3', ['Bedatrayee Kurian', 'Nitin Kurian'], ['F2_3a1']),
            ('F4_1a', 'F4_1', ['Somdev Chattopadhyay', 'Priyanka Chattopadhyay'], ['F4_1a1']),
        ]
        for nid, parent, names, children in cases:
            self.assertEqual([m['name'] for m in self.nodes[nid]['members']], names)
            self.assertEqual(self.nodes[nid]['lineageMemberIndex'], 0)
            self.assertIn(nid, self.nodes[parent]['children'])
            self.assertEqual(self.nodes[nid]['children'], children)
        self.assertEqual(self.person('F1_1b', 'Debankur Mukherjee')['gender'], 'male')
        self.assertEqual(self.person('F2_1a', 'Shabarna Mukherjee')['gender'], 'female')
        self.assertEqual(self.person('F4_1a', 'Somdev Chattopadhyay')['gender'], 'male')

    def test_alternate_name_not_a_fabricated_relationship(self):
        person = self.nodes['CSV_A_3_2']['members'][0]
        self.assertEqual(person['name'], 'Pankoj')
        self.assertEqual(person['alternateNames'], ['R. T. Martin'])
        self.assertEqual(person['nicknames'], [])
        self.assertEqual(len(self.nodes['CSV_A_3_2']['members']), 1)

    def test_no_private_questions_or_display_honorifics_in_public_data(self):
        self.assertNotIn('reviews', self.data)
        for n in self.nodes.values():
            self.assertNotIn('reviewIds', n)
            self.assertNotIn('Name not recorded', [m['name'] for m in n['members']])
            for m in n['members']:
                self.assertFalse(m['name'].startswith(('Smt', 'Miss ')))
                if 'gender' in m:
                    self.assertIn(m['gender'], ('male', 'female'))
            for note in n['notes']:
                self.assertTrue(note.startswith('Closed branch'))
        text = (ROOT / 'family-data.json').read_text().lower()
        for term in ('to confirm', 'unverified', 'question', 'uncertain', 'pending'):
            self.assertNotIn(term, text)

    def test_spelling_proposals_not_applied(self):
        self.assertEqual(self.nodes['CSV_E_2_4']['members'][0]['name'], 'Daliip Mukherjee')
        self.assertEqual(self.nodes['CSV_A_4_1']['members'][0]['name'], 'Sanjhy Mukherjee')
        self.assertEqual(self.nodes['E2_III']['members'][1]['name'], 'Arundhuti Mukherjee')
        self.assertEqual(self.nodes['G2_4']['members'][1]['name'], 'Narayn Ch. Mukherjee')
        self.assertEqual(self.nodes['CSV_D_2_2']['code'], 'D/2/2')

    def test_gender_markers_and_unsure_review_list(self):
        self.assertEqual(self.person('F4_1', 'Sankar Chatterjee')['gender'], 'male')
        self.assertEqual(self.person('F4_1', 'Sumita Chatterjee')['gender'], 'female')
        self.assertEqual(self.person('CSV_C_1_1', 'Annya Banerjee')['gender'], 'female')
        self.assertEqual(self.person('CSV_A_3_2', 'Pankoj')['gender'], 'male')
        self.assertEqual(self.person('CSV_E_2_4_ABHISHEK', 'Abhishek Mukherjee')['gender'], 'male')
        self.assertEqual(self.person('G1_1', 'Amal Banerjee')['gender'], 'male')
        unsure = {
            'Mon Sarkar', 'Mitu Chatterjee', 'Viyomi Kurian', 'Piku Ghoshal',
            'Daku Ghoshal', 'Suva Banerjee', 'Sanjhy Mukherjee',
            'Tojo Bhattacherjee', 'Amiya Prana', 'Srya Sen',
            'Krishnakal Banerjee', 'Santi Chatterjee', 'Bukun Chatterjee',
            'Sonavia Mukherjee', 'Laxmi Mondal', 'Tintin Chakraborty',
            'Rana Mukherjee', 'Biraj Mukherjee', 'Tulshi Mukherjee',
            'Bhatu Banerjee', 'Mani Banerjee', 'Jai Banerjee',
        }
        unmarked = {
            m['name'] for n in self.nodes.values() for m in n['members']
            if 'gender' not in m
        }
        self.assertEqual(unmarked, unsure)
        self.assertEqual(sum('gender' not in m for n in self.nodes.values() for m in n['members']), 22)
        self.assertEqual(self.nodes['F1_1a']['relationship'], 'group')

    def test_upasana_kaushik_have_no_children_as_confirmed(self):
        self.assertEqual(self.nodes['F2_2a']['children'], [])
        self.assertEqual(self.nodes['F2_2a']['childrenStatus'], 'none')
        self.assertEqual([nid for nid, n in self.nodes.items() if n.get('childrenStatus') == 'none'], ['F2_2a'])
        for nid in ['F1_1b', 'F2_1a', 'F2_1b', 'F2_3a', 'F4_1a']:
            self.assertTrue(self.nodes[nid]['children'])

    def test_retired_inputs_and_importers_are_absent(self):
        for path in ('PKM SIR FAMILY TYPING.csv', 'data/family-data.original.json',
                     'scripts/merge_family.py', 'scripts/family_confirmations.py',
                     'MERGE-REVIEW.md', 'family-tree.html'):
            self.assertFalse((ROOT / path).exists(), path)

    def test_f5_people_remain_without_original_spellings(self):
        self.assertEqual([m['name'] for m in self.nodes['F5']['members']],
                         ['Putul Chatterjee', 'Durga Prasad Chatterjee'])
        self.assertEqual(self.nodes['F5']['code'], 'F/5')
        self.assertEqual(self.nodes['F5']['children'], ['F5_1', 'F5_2'])


if __name__ == '__main__':
    unittest.main()
