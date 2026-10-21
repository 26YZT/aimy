from pathlib import Path
import json,re,shutil

ROOT=Path(__file__).parent
light={'canvas':'#F6F5F7','surface':'#FFFFFF','surfaceSubtle':'#F5F3F6','surfaceRaised':'#FFFFFF','text':'#26232A','textSecondary':'#69636E','textTertiary':'#77707D','border':'#E4E0E7','controlBorder':'#958B9C','action':'#2F2933','actionHover':'#49414E','actionPressed':'#1E1922','onAction':'#FFFFFF','accent':'#96415D','accentHover':'#7E334D','accentPressed':'#66253D','accentSoft':'#F6EAF0','onAccent':'#FFFFFF','focus':'#96415D','success':'#35634E','successSoft':'#EBF3EF','warning':'#805C23','warningSoft':'#FBF2E1','danger':'#A53546','dangerSoft':'#FBEDEF','disabled':'#EBE7EE','onDisabled':'#887D91'}
dark={'canvas':'#19181D','surface':'#222026','surfaceSubtle':'#2B2830','surfaceRaised':'#343039','text':'#F4F0F6','textSecondary':'#BAB1C3','textTertiary':'#ADA0B9','border':'#403A47','controlBorder':'#8D7E9B','action':'#EDE6F2','actionHover':'#FFFFFF','actionPressed':'#D4C7DF','onAction':'#2B2332','accent':'#E3A4BB','accentHover':'#F2BCD0','accentPressed':'#D48AA7','accentSoft':'#3C2A36','onAccent':'#2A1822','focus':'#E3A4BB','success':'#A4CCB9','successSoft':'#24372E','warning':'#E3C38D','warningSoft':'#3B3123','danger':'#F4A5B2','dangerSoft':'#432B34','disabled':'#3C3444','onDisabled':'#A89AB4'}
tokens={'meta':{'name':'Aimy · Quiet Rose / 静玫','version':'2.0.0-proposal','date':'2026-10-12','status':'design_reference_only','skillSource':'https://www.lovart.art/skills/pnVBXKl81a','skillReadScope':'public description and sample videos; full skill instructions not available'},'theme':{'light':light,'dark':dark},'type':{'sans':'-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif','mono':'"SFMono-Regular", Menlo, Consolas, monospace','scale':{'caption':12,'label':13,'body':14,'message':15,'subheading':18,'heading':24,'page':36},'lineHeight':{'compact':1.3,'body':1.6,'message':1.8},'weight':{'regular':400,'medium':500,'semibold':600}},'space':[4,8,12,16,20,24,32,40,48,64],'radius':{'small':6,'control':8,'message':14,'window':16,'pill':999},'motion':{'fast':120,'standard':160,'enter':220,'easing':'cubic-bezier(.2,.8,.2,1)','reducedMotion':'disable transforms, animation, and smooth scrolling'},'layout':{'chat':{'preferredWidth':520,'minWidth':360,'padding':24,'messageMaxWidth':'86%'},'settings':{'preferredWidth':920,'sidebar':196,'contentMaxWidth':640},'controls':{'button':36,'input':40,'iconHit':36,'coarseHit':44,'iconSize':18,'stroke':1.65},'gallerySidebar':208},'elevation':{'windowLight':'0 18px 48px #261D3210, 0 2px 8px #261D3208','windowDark':'0 18px 48px #00000025','popover':'0 8px 28px #261D321A'}}
light['onDanger']='#FFFFFF'
dark['onDanger']='#2A1822'
light['textTertiary']='#716A78'
light['controlBorder']='#8E8396'
(ROOT/'tokens.json').write_text(json.dumps(tokens,ensure_ascii=False,indent=2)+'\n')
(ROOT/'tokens.ts').write_text('// Design reference only. No runtime or persistence.\nexport const aimyTokens = '+json.dumps(tokens,ensure_ascii=False,indent=2)+' as const;\n\nexport type AimyTheme = keyof typeof aimyTokens.theme;\n')
def name(n):return re.sub('[A-Z]',lambda m:'-'+m.group().lower(),n)
css='/* Aimy Quiet Rose / 静玫 — v2 proposal, 2026-10-12. */\n'
for selector,theme in [(':root','light'),('[data-theme="dark"], .theme-dark','dark')]:
 css+=selector+' {\n  color-scheme: '+theme+';\n'
 css+=''.join(f'  --{name(k)}: {v};\n' for k,v in tokens['theme'][theme].items())+'}\n'
css+=':root {\n  --font-sans: '+tokens['type']['sans']+';\n  --font-mono: '+tokens['type']['mono']+';\n'
css+=''.join(f'  --space-{v}: {v}px;\n' for v in tokens['space'])
css+=''.join(f'  --radius-{k}: {v}px;\n' for k,v in tokens['radius'].items())
css+='  --ease: cubic-bezier(.2,.8,.2,1);\n  --duration: 160ms;\n  --shadow-window: '+tokens['elevation']['windowLight']+';\n}\n[data-theme="dark"],.theme-dark { --shadow-window: '+tokens['elevation']['windowDark']+'; }\n'
(ROOT/'tokens.css').write_text(css)
assets=ROOT/'assets';assets.mkdir(exist_ok=True)
v1=ROOT.parent/'2026-10-12-粉雾风格库'/'assets'
shutil.copyfile(v1/'ui-icons.svg',assets/'ui-icons.svg')
shutil.copyfile(v1/'aimy-icon-light.svg',assets/'aimy-icon-v1.svg')
shutil.copyfile(v1/'aimy-mark.svg',assets/'aimy-mark-v1.svg')
mark='''<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none" role="img" aria-label="Aimy 双弧标记候选"><path d="M41 13C31 7 19 13 16 24c-3 9 0 18 8 23" stroke="#96415D" stroke-width="5.5" stroke-linecap="round"/><path d="M23 51c10 6 22 0 25-11 3-9 0-18-8-23" stroke="#C7849E" stroke-width="5.5" stroke-linecap="round"/></svg>'''
(assets/'aimy-symbol.svg').write_text(mark+'\n')
(assets/'aimy-symbol-dark.svg').write_text(mark.replace('#96415D','#E3A4BB').replace('#C7849E','#BA718F')+'\n')
print('v2 light/dark tokens and five local SVG assets prepared.')
