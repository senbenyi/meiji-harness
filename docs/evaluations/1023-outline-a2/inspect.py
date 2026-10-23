"""汇总原始结果供人工逐项核验；格式失败的可读文字不算成功。"""
import json, re
from pathlib import Path

root = Path(__file__).resolve().parent
old = root.parent / '1023-outline-ab'
load = lambda p: json.loads(p.read_text())
controls = []
full = []

def extract(path):
    if not path.exists():
        return []
    raw = path.read_text()
    texts = []
    for m in re.finditer(r'"integrated_multimodal_description"\s*:\s*("(?:\\.|[^"\\])*")', raw):
        try:
            text = json.loads(m[1])
        except json.JSONDecodeError:
            continue
        ids = list(re.finditer(r'"clip_id"\s*:\s*"([^"\n]+)"', raw[:m.start()]))
        texts.append({'clip_id': ids[-1][1] if ids else None, 'text': text, 'chars': len(text),
                      'controlLanguageFlags': re.findall(r'不新增|不重播|不重复|不扩写|不切镜|不重演|不得|本片不|不改变|不跳至|逐字|保持.*?不', text)})
    return texts

for source in sorted((root / 'controls').glob('*/round-*/source.json')):
    row = {'case': source.parent.parent.name, 'round': int(source.parent.name.split('-')[1]), 'source': load(source)}
    for version in ['A1', 'A2']:
        p = source.parent / version
        row[version] = {'result': load(p / 'result.json') if (p / 'result.json').exists() else {'status': 'pending'},
                        'descriptions': extract(p / 'response.txt'), 'path': str((p / 'response.txt').relative_to(root))}
    controls.append(row)
for result in sorted((root / 'results').glob('*/round-*/A2/result.json')):
    row = load(result)
    row['descriptions'] = extract(result.parent / 'final/response.txt')
    row['selection'] = load(result.parent / 'final/selection.json') if (result.parent / 'final/selection.json').exists() else None
    row['path'] = str(result.relative_to(root))
    historic = old / f"results/{row['key']}/round-{row['round']}/A"
    row['historicalA'] = {'result': load(historic / 'result.json'), 'finalValid': (historic / 'final-v2/parsed.json').exists(),
                          'descriptions': extract(historic / 'final-v2/response.txt')}
    full.append(row)
report = {'controls': controls, 'full': full, 'note': '语言模式匹配仅定位待查片段，不是质量评分；可读格式失败结果不计程序成功。'}
(root / 'inspection.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
lines = []
for row in controls:
    lines.append(f"\n=== 固定输入 {row['case']} round-{row['round']} ===")
    for version in ['A1', 'A2']:
        lines.append(f"{version}：{row[version]['result']['status']}")
        for d in row[version]['descriptions']:
            lines.append(f"【{d['clip_id']}】{d['text']}")
for row in full:
    lines.append(f"\n=== 全链路 {row['key']} round-{row['round']} A2：{row['status']} ===")
    for d in row['descriptions']:
        lines.append(f"【{d['clip_id']}】{d['text']}")
(root / 'final-texts.txt').write_text('\n'.join(lines) + '\n')
print(json.dumps({'fullFinished': len(full), 'fullPassed': sum(x['status'] == 'completed' for x in full),
                  'controlFinished': sum(x[v]['result']['status'] != 'pending' for x in controls for v in ['A1','A2']),
                  'controlPassed': sum(x[v]['result']['status'] == 'completed' for x in controls for v in ['A1','A2'])}, ensure_ascii=False))
