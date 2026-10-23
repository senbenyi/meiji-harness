"""只读提取原始提示词中的可解码文本，格式失败仍是失败，不修复输出。"""
import json,re,sys
from pathlib import Path
root=Path(__file__).resolve().parent
stage=sys.argv[1] if len(sys.argv)>1 else 'final-v2'
rows=[]
for path in sorted((root/'results').glob(f'*/round-*/*/{stage}/response.txt')):
 raw=path.read_text()
 try:json.loads(raw);syntactic=True
 except json.JSONDecodeError:syntactic=False
 descriptions=[]
 for match in re.finditer(r'"integrated_multimodal_description"\s*:\s*("(?:\\.|[^"\\])*")',raw):
  try:descriptions.append(json.loads(match.group(1)))
  except json.JSONDecodeError:pass
 failure=path.parent/'failure.json'
 selection=json.loads((path.parent/'selection.json').read_text())
 rows.append({'path':str(path.relative_to(root)), 'jsonSyntaxValid':syntactic,'pipelineValid':(path.parent/'parsed.json').exists(),'failure':json.loads(failure.read_text()) if failure.exists() else None,'selectedTopics':[x['topic']['id'] for x in selection['selected']], 'selectionProblems':selection['problems'],'contentOnlyDescriptions':descriptions})
(root/f'{stage}-content-inspection.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
for r in rows:print(r['path'],'可用',r['pipelineValid'],'可读正文',len(r['contentOnlyDescriptions']),'主题',r['selectedTopics'])
