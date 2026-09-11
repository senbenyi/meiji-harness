"""Snapshot and compile the five RunPod MiniMax H3 workflows."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'src/workflows/templates/runpod'
DEFAULT_URL = 'https://36we4j3zo503js-8188.proxy.runpod.net'
WORKFLOWS = {
    't2va': {'file': 'MiniMaxH3-Turbo-T2VA.json', 'macros': [105], 'mirrors': [137], 'media': {}},
    'i2va': {'file': 'MiniMaxH3-Turbo-I2VA.json', 'macros': [105], 'mirrors': [137], 'media': {'first_frame': 114}},
    'fl2va': {'file': 'MiniMaxH3-Turbo-FL2VA.json', 'macros': [105], 'mirrors': [137], 'media': {'first_frame': 114, 'last_frame': 147}},
    'fl2va-loop': {'file': 'MiniMaxH3-Turbo-FL2VA-Loop.json', 'macros': [105, 255], 'media': {'first_frame': 114, 'last_frame': 147}},
    'r2va': {'file': 'MiniMaxH3-Turbo-R2VA.json', 'macros': [105], 'mirrors': [137], 'media': {'reference_image_1': 114, 'reference_image_2': 152}},
}
WIDGET_TYPES = {'BOOLEAN', 'COMBO', 'FLOAT', 'INT', 'STRING'}
MISSING = object()


def request_json(url):
    with urlopen(Request(url, headers={'User-Agent': 'dsh-elysium-tools-workflow-sync/1.0'}), timeout=60) as response:
        body = response.read()
    return body, json.loads(body)


def normalize_links(rows):
    result = {}
    for row in rows:
        values = [row[key] for key in ('id', 'origin_id', 'origin_slot', 'target_id', 'target_slot', 'type')] if isinstance(row, dict) else row[:6]
        result[values[0]] = values
    return result


class Compiler:
    def __init__(self, workflow, schemas):
        self.workflow = workflow
        self.schemas = schemas
        self.definitions = {item['id']: item for item in workflow.get('definitions', {}).get('subgraphs', [])}
        self.graph = {}
        self.containers = {}
        self.instances = {}

    @staticmethod
    def key(prefix, node_id):
        return f'{prefix}{node_id}'

    def container(self, prefix, definition=None):
        if prefix not in self.containers:
            source = definition or self.workflow
            self.containers[prefix] = ({node['id']: node for node in source['nodes']}, normalize_links(source.get('links', [])))
        return self.containers[prefix]

    def source(self, prefix, node_id, slot, definition=None, external=None):
        if node_id == -10:
            return external[slot]
        nodes, links = self.container(prefix, definition)
        node = nodes[node_id]
        if node['type'] in self.definitions:
            return self.expand_macro(prefix, node, definition, external)[slot]
        schema = self.schemas.get(node['type'])
        if node.get('mode', 0) in (2, 4) or schema is None:
            output_type = node.get('outputs', [])[slot].get('type')
            candidates = [item for item in node.get('inputs', []) if item.get('link') is not None and item.get('type') == output_type]
            if schema is None and not candidates:
                candidates = [item for item in node.get('inputs', []) if item.get('link') is not None]
            if len(candidates) != 1:
                raise ValueError(f'Cannot bypass {node["type"]} output {slot}')
            row = links[candidates[0]['link']]
            return self.source(prefix, row[1], row[2], definition, external)
        self.compile_node(prefix, node, definition, external)
        return [self.key(prefix, node_id), slot]

    def expand_macro(self, prefix, macro, definition=None, external=None):
        cache_key = (prefix, macro['id'])
        if cache_key in self.instances:
            return self.instances[cache_key]
        subgraph = self.definitions[macro['type']]
        _, links = self.container(prefix, definition)
        connected = {item['name']: item.get('link') for item in macro.get('inputs', [])}
        values = []
        widget_index = 0
        for index, item in enumerate(subgraph.get('inputs', [])):
            link_id = connected.get(item['name'])
            widget_value = MISSING
            if item['type'] in WIDGET_TYPES:
                widget_value = macro.get('widgets_values', [])[widget_index]
                widget_index += 1
            if link_id is None:
                values.append(widget_value)
            else:
                row = links[link_id]
                values.append(self.source(prefix, row[1], row[2], definition, external))
        child_prefix = f'{prefix}{macro["id"]}_'
        child_nodes, child_links = self.container(child_prefix, subgraph)
        for node in child_nodes.values():
            if node.get('mode', 0) == 0 and node['type'] in self.schemas:
                self.compile_node(child_prefix, node, subgraph, values)
        outputs = []
        for index in range(len(subgraph.get('outputs', []))):
            row = next(row for row in child_links.values() if row[3:5] == [-20, index])
            outputs.append(self.source(child_prefix, row[1], row[2], subgraph, values))
        self.instances[cache_key] = outputs
        return outputs

    def compile_node(self, prefix, node, definition=None, external=None):
        node_key = self.key(prefix, node['id'])
        if node_key in self.graph:
            return
        schema = self.schemas[node['type']]
        allowed = set(schema.get('input', {}).get('required', {})) | set(schema.get('input', {}).get('optional', {}))
        inputs = {key: value for key, value in node.get('widgets_values_named', {}).items() if key in allowed}
        _, links = self.container(prefix, definition)
        for item in node.get('inputs', []):
            if item.get('link') is None:
                continue
            row = links[item['link']]
            value = self.source(prefix, row[1], row[2], definition, external)
            if value is not MISSING:
                inputs[item['name']] = value
        self.graph[node_key] = {'class_type': node['type'], 'inputs': inputs,
                                '_meta': {'title': node.get('title') or node['type'], 'source_id': node_key}}

    def compile(self):
        nodes, _ = self.container('n')
        for node in nodes.values():
            if node.get('mode', 0) == 0 and node['type'] in self.schemas:
                self.compile_node('n', node)
            elif node.get('mode', 0) == 0 and node['type'] in self.definitions:
                self.expand_macro('n', node)
        return self.graph

    def macro_input_binding(self, macro_id, name):
        macro = next(node for node in self.workflow['nodes'] if node['id'] == macro_id)
        subgraph = self.definitions[macro['type']]
        slot = next(index for index, item in enumerate(subgraph['inputs']) if item['name'] == name)
        row = next(row for row in normalize_links(subgraph['links']).values() if row[1:3] == [-10, slot])
        target = next(node for node in subgraph['nodes'] if node['id'] == row[3])
        return {'node': self.key(f'n{macro_id}_', target['id']), 'input': target['inputs'][row[4]]['name']}


def validate(graph, schemas):
    for node_id, node in graph.items():
        schema = schemas[node['class_type']]
        required = schema.get('input', {}).get('required', {})
        optional = schema.get('input', {}).get('optional', {})
        dynamic = {name for name, spec in {**required, **optional}.items() if spec[0] == 'COMFY_AUTOGROW_V3'}
        required_dynamic = dynamic & set(required)
        missing = {name for name in required if name not in node['inputs'] and not (name in required_dynamic and any(key.startswith(f'{name}.') for key in node['inputs']))}
        unknown = {name for name in node['inputs'] if name not in required and name not in optional and not any(name.startswith(f'{root}.') for root in dynamic)}
        if missing or unknown:
            raise ValueError(f'{node_id} inputs missing={sorted(missing)} unknown={sorted(unknown)}')
        for name, value in node['inputs'].items():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str) and value[0] not in graph:
                raise ValueError(f'{node_id}.{name} links to missing {value[0]}')


def compile_bundle(mode, workflow, schemas, source_path, digest):
    config = WORKFLOWS[mode]
    compiler = Compiler(workflow, schemas)
    graph = compiler.compile()
    validate(graph, schemas)
    prompt_bindings = [compiler.macro_input_binding(node_id, 'prompt') for node_id in config['macros']]
    prompt_bindings += [{'node': compiler.key('n', node_id), 'input': 'anything'} for node_id in config.get('mirrors', [])]
    for item in prompt_bindings:
        graph[item['node']]['inputs'][item['input']] = ''
    bindings = {
        'prompt': prompt_bindings,
        'media': {name: {'node': compiler.key('n', node_id), 'input': 'image'} for name, node_id in config['media'].items()},
        'output': {'node': compiler.key('n', 126), 'input': 'filename_prefix'},
    }
    for item in [*bindings['prompt'], *bindings['media'].values(), bindings['output']]:
        if item['node'] not in graph or item['input'] not in graph[item['node']]['inputs']:
            raise ValueError(f'Invalid {mode} binding: {item}')
    return {'mode': mode, 'source': {'path': source_path, 'sha256': digest},
            'workflow': workflow, 'graph': graph, 'bindings': bindings}


def build(base_url):
    base_url = base_url.rstrip('/')
    _, schemas = request_json(f'{base_url}/object_info')
    for mode, config in WORKFLOWS.items():
        source_path = f'minimax/{config["file"]}'
        body, workflow = request_json(f'{base_url}/userdata/{quote(f"workflows/{source_path}", safe="")}')
        yield mode, compile_bundle(mode, workflow, schemas, source_path, hashlib.sha256(body).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default=DEFAULT_URL)
    parser.add_argument('--output-dir', type=Path, default=DIRECTORY)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--sync', action='store_true')
    args = parser.parse_args()
    if args.check == args.sync:
        parser.error('choose exactly one of --check or --sync')
    for mode, bundle in build(args.url):
        target = args.output_dir / f'{mode}.json'
        if args.check:
            if json.loads(target.read_text()) != bundle:
                raise SystemExit(f'RunPod workflow differs: {target}')
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + '\n')
        print(f'{"CHECK" if args.check else "SYNC"} {mode} {bundle["source"]["sha256"]}')


if __name__ == '__main__':
    main()
