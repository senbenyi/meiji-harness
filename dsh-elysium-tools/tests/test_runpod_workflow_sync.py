"""Validate the five RunPod workflow snapshots without submitting GPU work."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('h3_export', ROOT / 'scripts/sync_runpod_video_workflows.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class H3WorkflowTests(unittest.TestCase):
    def test_exactly_five_runpod_modes_are_packaged(self):
        self.assertEqual(set(module.WORKFLOWS), {'t2va', 'i2va', 'fl2va', 'fl2va-loop', 'r2va'})
        self.assertEqual({path.stem for path in module.DIRECTORY.glob('*.json')}, set(module.WORKFLOWS))

    def test_snapshots_have_complete_api_links_and_bindings(self):
        for mode in module.WORKFLOWS:
            with self.subTest(mode=mode):
                bundle = json.loads((module.DIRECTORY / f'{mode}.json').read_text())
                self.assertEqual(bundle['mode'], mode)
                self.assertNotRegex(json.dumps(bundle), r'Qwen3\.5|AILab_QwenVL')
                self.assertTrue(bundle['workflow']['definitions']['subgraphs'])
                for container in [bundle['workflow'], *bundle['workflow']['definitions']['subgraphs']]:
                    node_ids = {node['id'] for node in container['nodes']}
                    for link in container['links']:
                        origin, target = (link[1], link[3]) if isinstance(link, list) else (link['origin_id'], link['target_id'])
                        self.assertTrue(origin == -10 or origin in node_ids)
                        self.assertTrue(target == -20 or target in node_ids)
                self.assertRegex(bundle['source']['sha256'], r'^[0-9a-f]{64}$')
                graph = bundle['graph']
                for node in graph.values():
                    for value in node['inputs'].values():
                        if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
                            self.assertIn(value[0], graph)
                for binding in [*bundle['bindings']['prompt'], *bundle['bindings']['media'].values(), bundle['bindings']['output']]:
                    self.assertIn(binding['node'], graph)
                    self.assertIn(binding['input'], graph[binding['node']]['inputs'])


if __name__ == '__main__':
    unittest.main()
