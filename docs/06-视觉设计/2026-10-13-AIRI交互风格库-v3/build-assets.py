"""Export local canonical tokens and image sizes. Requires Pillow for PNG export."""
from pathlib import Path
import json,re
from PIL import Image

P=Path(__file__).parent
t=json.loads((P/'tokens.json').read_text())
(P/'tokens.ts').write_text('// Design reference only.\nexport const aimyTokens = '+json.dumps(t,ensure_ascii=False,indent=2)+' as const;\nexport type AimyTheme = keyof typeof aimyTokens.theme;\n')
def kebab(s):return re.sub('[A-Z]',lambda m:'-'+m.group().lower(),s)
css='/* Aimy v3 2026-10-13. Derived from tokens.json. */\n'
for selector,theme in [(':root','light'),('[data-theme="dark"]','dark')]:
 css+=selector+' {\n  color-scheme: '+theme+';\n'+''.join(f'  --{kebab(k)}: {v};\n' for k,v in t['theme'][theme].items())+'}\n'
css+=':root {\n  --font-sans: '+t['type']['sans']+';\n  --font-mono: '+t['type']['mono']+';\n'
css+=''.join(f'  --radius-{k}: {v}px;\n' for k,v in t['radius'].items())
css+=''.join(f'  --space-{v}: {v}px;\n' for v in t['space'])
css+='  --message-size: 15px;\n  --duration: 180ms;\n  --ease: cubic-bezier(.2,.8,.2,1);\n  --shadow-window: '+t['elevation']['windowLight']+';\n  --stage-background: #EFE7ED;\n}\n[data-theme="dark"] { --shadow-window: '+t['elevation']['windowDark']+'; --stage-background: #19171B; }\n'
(P/'tokens.css').write_text(css)
im=Image.open(P/'assets'/'aimy-icon-master.png').convert('RGB')
for size in [1024,512,256,128,64,32]:im.resize((size,size),Image.Resampling.LANCZOS).save(P/'assets'/f'aimy-icon-{size}.png')
print('Derived TS/CSS and six PNG sizes exported. Canonical artwork/tokens preserved.')
