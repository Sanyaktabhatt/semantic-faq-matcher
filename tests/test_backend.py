"""Deterministic scoring and API contract tests; no model download required."""
import asyncio
import csv
from pathlib import Path
import tempfile
import unittest

import httpx
import numpy as np

from backend.evaluation import Evaluator
from backend.main import create_app
from backend.matcher import FAQMatcher, content_tokens, tokenize
from backend.repository import CSVFAQRepository


class FixedEncoder:
    """Known normalized vectors isolate scoring and threshold behavior."""
    def encode(self, texts, **kwargs):
        vectors = {'track order': [1., 0.], 'reset password': [0., 1.],
                   'order location': [0.8, 0.6], 'unrelated': [-1., 0.],
                   'where is my parcel': [0.6, 0.8], 'forgot login': [0., 1.],
                   'lost my login': [0.1, 0.995]}
        return np.array([vectors[text] for text in texts])


class MatcherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.faq_file = self.root / 'faqs.csv'
        self.write_csv(self.faq_file, ['faq_id', 'category', 'question', 'answer'], [
            ['ORD001', 'Orders', 'track order', 'Use tracking.'],
            ['ACC002', 'Account', 'reset password', 'Use reset.'],
        ])
        self.matcher = FAQMatcher(CSVFAQRepository(self.faq_file), FixedEncoder())
        self.write_csv(self.root / 'semantic_faq_test_queries.csv', ['user_query', 'expected_faq_id'], [
            ['order location', 'ORD001'], ['reset password', 'MISSING'],
        ])
        self.write_csv(self.root / 'semantic_faq_additional_test_queries.csv', ['user_query', 'expected_faq_id'], [
            ['reset password', 'ACC002'],
        ])
        self.write_csv(self.root / 'semantic_faq_no_match_test_queries.csv', ['user_query'], [['unrelated']])

    @staticmethod
    def write_csv(path, columns, rows):
        with path.open('w', newline='') as stream:
            writer = csv.writer(stream); writer.writerow(columns); writer.writerows(rows)

    def test_notebook_tokenization(self):
        self.assertEqual(tokenize("Order, ORDER! #123 can't"), {'order', '123', 'can', 't'})

    def test_stopwords_removed_from_keyword_tokens(self):
        self.assertEqual(content_tokens('How do I track my order?'), {'track', 'order'})
        self.assertEqual(content_tokens('how do I'), {'how', 'do', 'i'})

    def test_alternate_phrasing_scores_best_variant(self):
        self.write_csv(self.root / 'faq_alternate_questions.csv', ['faq_id', 'alternate_question'],
                       [['ACC002', 'where is my parcel'], ['ORD001', 'forgot login']])
        matcher = FAQMatcher(CSVFAQRepository(self.faq_file), FixedEncoder())
        self.assertEqual(matcher.phrasing_count, 4)
        # 'where is my parcel' matches ACC002's alternate exactly, beating ORD001 (0.6).
        result = matcher.find_answer('where is my parcel')
        self.assertEqual(result.faq_id, 'ACC002')
        self.assertAlmostEqual(result.top_matches[0].semantic_similarity, 1.0)
        self.assertEqual(result.top_matches[0].matched_phrasing, 'where is my parcel')
        self.assertEqual(result.matched_question, 'reset password')

    def test_alternates_must_reference_known_ids(self):
        self.write_csv(self.root / 'faq_alternate_questions.csv', ['faq_id', 'alternate_question'], [['NOPE01', 'x']])
        with self.assertRaisesRegex(ValueError, 'unknown FAQ IDs'):
            CSVFAQRepository(self.faq_file).load()

    def test_learning_adds_phrasing_and_persists(self):
        learned = self.root / 'runtime' / 'learned.csv'
        matcher = FAQMatcher(CSVFAQRepository(self.faq_file), FixedEncoder(), learned_path=learned)
        self.assertTrue(matcher.learn('lost my login', 'acc002'))
        self.assertFalse(matcher.learn('Lost my login', 'ACC002'))  # duplicate, case-insensitive
        self.assertEqual(matcher.learned_count, 1)
        top = matcher.find_answer('lost my login').top_matches[0]
        self.assertEqual((top.faq_id, top.phrasing_source), ('ACC002', 'learned'))
        self.assertAlmostEqual(top.semantic_similarity, 1.0)
        reloaded = FAQMatcher(CSVFAQRepository(self.faq_file), FixedEncoder(), learned_path=learned)
        self.assertEqual(reloaded.learned_phrasings(), [{'faq_id': 'ACC002', 'query': 'lost my login'}])
        self.assertEqual(reloaded.reset_learned(), 1)
        self.assertFalse(learned.exists())
        with self.assertRaises(KeyError):
            matcher.learn('x', 'NOPE')

    def test_confidence_ambiguity_and_terms(self):
        result = self.matcher.find_answer('track order')
        self.assertEqual(result.confidence, 'high')
        self.assertFalse(result.ambiguous)
        self.assertEqual(result.top_matches[0].matched_terms, ['order', 'track'])
        # 'order location' scores 0.755 (>= 0.70), so it is high confidence.
        self.assertEqual(self.matcher.find_answer('order location', mode='overlap').confidence, 'high')
        self.assertEqual(self.matcher.find_answer('unrelated').confidence, 'low')
        # Two candidates both above a low threshold and within the margin are ambiguous.
        tie = self.matcher.find_answer('where is my parcel', 0.1)
        self.assertGreater(tie.margin, 0)
        self.assertEqual(tie.ambiguous, tie.margin < 0.04)

    def test_bm25_hybrid_formula_and_modes(self):
        result = self.matcher.find_answer('order location')
        self.assertEqual(result.scoring_mode, 'bm25')
        top = result.top_matches[0]
        self.assertTrue(0 <= top.keyword_overlap < 1)
        self.assertAlmostEqual(top.score, 0.85 * top.semantic_similarity + 0.15 * top.keyword_overlap)
        semantic = self.matcher.rank_many(['order location'], mode='semantic')[0][0]
        self.assertAlmostEqual(semantic.score, 0.8)
        with self.assertRaises(ValueError):
            self.matcher.rank_many(['x'], mode='nope')

    def test_bm25_rewards_rare_shared_terms(self):
        # In a larger corpus BM25 weights a rare shared word; scores stay in [0, 1).
        rows = [['ORD001', 'Orders', 'track order', 'a'], ['ACC002', 'Account', 'reset password', 'b']]
        rows += [[f'GEN{i:03}', 'General', f'filler topic {i}', 'c'] for i in range(8)]
        self.write_csv(self.faq_file, ['faq_id', 'category', 'question', 'answer'], rows)
        class Flat:
            def encode(self, texts, **kwargs):
                return np.array([[1., 0.] for _ in texts])
        matcher = FAQMatcher(CSVFAQRepository(self.faq_file), Flat())
        keyword = matcher.keyword_scores('reset my password', 'bm25')
        self.assertEqual(matcher.faqs[int(np.argmax(keyword))].faq_id, 'ACC002')
        self.assertTrue(((keyword >= 0) & (keyword < 1)).all())

    def test_category_filter_and_prediction(self):
        filtered = self.matcher.find_answer('order location', category='Account')
        self.assertEqual([m.faq_id for m in filtered.top_matches], ['ACC002'])
        self.assertEqual(filtered.category_filter, 'Account')
        with self.assertRaises(ValueError):
            self.matcher.find_answer('order location', category='Nope')
        result = self.matcher.find_answer('track order')
        self.assertEqual(result.predicted_categories[0].name, 'Orders')
        self.assertAlmostEqual(result.predicted_categories[0].score, result.similarity)
        # A category filter restricts results but not the prediction.
        self.assertEqual(filtered.predicted_categories[0].name, 'Orders')

    def test_dataset_manifest_defines_test_sets(self):
        (self.root / 'datasets.json').write_text(
            '[{"key": "dev", "name": "Dev", "filename": "semantic_faq_additional_test_queries.csv", "labeled": true},'
            ' {"key": "unrelated", "name": "Unrelated", "filename": "semantic_faq_no_match_test_queries.csv", "labeled": false}]')
        evaluator = Evaluator(self.matcher, self.root)
        result = evaluator.run(0.45)
        self.assertEqual([d['key'] for d in result['datasets']], ['dev', 'unrelated'])
        self.assertEqual(result['datasets'][0]['top1_accuracy'], 1)
        self.assertEqual(result['datasets'][1]['rejection_rate'], 1)
        self.assertEqual(len(evaluator.embed('semantic_faq_additional_test_queries.csv', ['reset password'])), 1)

    def test_semantic_map_and_confusable_pairs(self):
        data = self.matcher.semantic_map()
        self.assertEqual(len(data['points']), 2)
        self.assertTrue(0 < data['explained'] <= 1.0 + 1e-9)
        pairs = self.matcher.confusable_pairs()
        self.assertEqual(len(pairs), 1)
        self.assertAlmostEqual(pairs[0]['similarity'], 0.0)

    def test_formula_and_query_denominator(self):
        result = self.matcher.find_answer('order location', mode='overlap')
        self.assertEqual(result.faq_id, 'ORD001')
        self.assertAlmostEqual(result.similarity, 0.85 * 0.8 + 0.15 * 0.5)
        self.assertAlmostEqual(result.top_matches[0].semantic_similarity, 0.8)
        self.assertAlmostEqual(result.top_matches[0].keyword_overlap, 0.5)

    def test_threshold_uses_unrounded_score_and_accepts_equality(self):
        score = self.matcher.find_answer('order location').similarity
        self.assertEqual(self.matcher.find_answer('order location', score).status, 'Match found')
        rejected = self.matcher.find_answer('order location', score + 0.000001)
        self.assertIsNone(rejected.faq_id)
        self.assertIsNone(rejected.matched_question)
        self.assertEqual(len(rejected.top_matches), 2)

    def test_empty_query_does_not_encode(self):
        result = self.matcher.find_answer('  ')
        self.assertEqual(result.status, 'Invalid query')
        self.assertEqual(result.top_matches, [])

    def test_invalid_threshold(self):
        with self.assertRaises(ValueError):
            self.matcher.find_answer('track order', 1.1)

    def test_unrelated_query_is_rejected(self):
        result = self.matcher.find_answer('unrelated')
        self.assertEqual(result.status, 'No suitable match')
        self.assertIsNone(result.faq_id)

    def test_repository_rejects_duplicate_ids(self):
        with self.faq_file.open('a') as stream:
            stream.write('ORD001,Orders,another question,another answer\n')
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            CSVFAQRepository(self.faq_file).load()

    def test_repository_rejects_missing_fields(self):
        self.faq_file.write_text('faq_id,question\nX,question\n')
        with self.assertRaisesRegex(ValueError, 'missing'):
            CSVFAQRepository(self.faq_file).load()

    def test_repository_rejects_blank_fields(self):
        self.faq_file.write_text('faq_id,category,question,answer\nX,Orders,question,\n')
        with self.assertRaisesRegex(ValueError, 'complete'):
            CSVFAQRepository(self.faq_file).load()

    def test_invalid_labels_excluded_and_rejections_measured(self):
        result = Evaluator(self.matcher, self.root).run(0.45)
        original, additional, unrelated = result['datasets'][:3]
        self.assertEqual((original['count'], original['valid_count'], original['invalid_count']), (2, 1, 1))
        self.assertEqual(original['top1_accuracy'], 1)
        self.assertEqual(additional['accepted_accuracy'], 1)
        self.assertEqual(unrelated['rejection_rate'], 1)
        self.assertEqual(unrelated['false_accepts'], 0)
        self.assertIsNone(result['rows'][1]['correct'])
        self.assertEqual(result['duplicate_query_rows'], 1)

    def test_rejected_labeled_query_counts_as_incorrect(self):
        evaluator = Evaluator(self.matcher, self.root)
        result = evaluator.run(0.99)
        self.assertEqual(result['datasets'][0]['top1_accuracy'], 1)
        self.assertEqual(result['datasets'][0]['accepted_accuracy'], 0)

    def test_missing_test_files_have_null_metrics(self):
        for path in self.root.glob('semantic*.csv'):
            path.unlink()
        result = Evaluator(self.matcher, self.root).run(0.45)
        self.assertFalse(result['datasets'][0]['available'])
        self.assertIsNone(result['datasets'][0]['top1_accuracy'])

    def test_real_api_routes_and_request_validation(self):
        async def check():
            # A periodic loop wake also supports sandboxes that block thread wakeup sockets.
            async def pulse():
                while True:
                    await asyncio.sleep(0.01)
            heartbeat = asyncio.create_task(pulse())
            self.addCleanup(heartbeat.cancel)
            app = create_app(self.matcher, self.root)
            async with app.router.lifespan_context(app):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                    self.assertEqual((await client.get('/api/health')).json()['faq_count'], 2)
                    self.assertEqual(len((await client.get('/api/faqs?category=Orders')).json()), 1)
                    self.assertEqual((await client.get('/api/faqs?search=missing')).json(), [])
                    answer = await client.post('/api/match', json={'query': 'order location'})
                    self.assertEqual(answer.status_code, 200, answer.text)
                    self.assertEqual(answer.json()['faq_id'], 'ORD001')
                    for body in [{'query': '   '}, {'query': 'x', 'threshold': -1}, {'query': 'x' * 2001}, {'query': 'x', 'threshold': 'NaN'}]:
                        self.assertEqual((await client.post('/api/match', json=body)).status_code, 422)
                    report = await client.post('/api/evaluate', json={'threshold': 0.45})
                    self.assertEqual(report.status_code, 200, report.text)
                    self.assertEqual(report.json()['datasets'][0]['invalid_count'], 1)
                    feedback = await client.post('/api/feedback', json={'query': 'lost my login', 'faq_id': 'ACC002', 'helpful': True})
                    self.assertEqual(feedback.status_code, 200, feedback.text)
                    self.assertTrue(feedback.json()['learned'])
                    bad = await client.post('/api/feedback', json={'query': 'x', 'faq_id': 'NOPE', 'helpful': True})
                    self.assertEqual(bad.status_code, 422)
                    insights = (await client.get('/api/insights')).json()
                    self.assertEqual(insights['total_queries'], 1)
                    self.assertEqual(insights['feedback']['learned'], 1)
                    self.assertEqual(insights['learned_count'], 1)
                    self.assertEqual(len((await client.get('/api/map')).json()['points']), 2)
                    projection = await client.post('/api/map/project', json={'query': 'track order'})
                    self.assertEqual(projection.json()['top'][0]['faq_id'], 'ORD001')
                    self.assertEqual((await client.post('/api/learned/reset')).json()['removed'], 1)
                    filtered = await client.post('/api/match', json={'query': 'order location', 'category': 'Account'})
                    self.assertEqual(filtered.json()['top_matches'][0]['faq_id'], 'ACC002')
                    self.assertEqual((await client.post('/api/match', json={'query': 'x', 'category': 'Nope'})).status_code, 422)
                    compare = (await client.post('/api/evaluate/compare', json={'threshold': 0.45})).json()
                    self.assertEqual([m['mode'] for m in compare['modes']], ['keyword', 'semantic', 'overlap', 'bm25'])
                    self.assertEqual(compare['categories'][0]['centroid_accuracy'], 1)
                    download = await client.get('/api/dataset/download')
                    self.assertEqual(download.status_code, 200)
                    self.assertIn('text/csv', download.headers['content-type'])
        asyncio.run(check())


if __name__ == '__main__':
    unittest.main()
