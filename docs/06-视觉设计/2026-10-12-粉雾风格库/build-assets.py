"""Build original editable vector brand assets. No reference pixels are embedded."""
from pathlib import Path
import json

ROOT = Path(__file__).parent

# Original paths, in a 512-unit artboard. The tucked chin and folded sleeve are
# the signature; details are intentionally sparse enough for Dock sizes.
def artwork(hair="#EDBED0", ink="#CE7094", face="#FFF9FC", compact=False):
    small = '' if compact else f'''
    <path d="M204 236c8 22 19 39 34 52" fill="none" stroke="{ink}" stroke-width="10" stroke-linecap="round"/>
    <path d="M186 318c8 2 16-1 20-7" fill="none" stroke="{ink}" stroke-width="9" stroke-linecap="round"/>
    <path d="M237 145l-13-32-9 36" fill="{face}" opacity=".9"/>
    <path d="M170 208l-14-17 1 33" fill="{face}" opacity=".9"/>
    <path d="M340 219c19 18 30 39 34 60" fill="none" stroke="{face}" stroke-width="9" stroke-linecap="round" opacity=".8"/>
    <path d="M335 389c18 2 32 12 41 25" fill="none" stroke="{ink}" stroke-width="9" stroke-linecap="round"/>
    '''
    return f'''<g transform="translate(-36 0)">
    <path d="M185 190l-40-21c-5-3-9 0-9 6l7 76 44-22z" fill="{ink}"/>
    <path d="M185 181c11-17 18-26 28-32l5-65c0-8 6-11 12-5l49 57c65 0 116 37 138 92 21 53 6 88 12 128 4 30 17 51 28 65-42 13-91 18-137 6l-75-45-54-10-13-31-27-9c-7-2-8-7-3-12l27-30c-7-40-1-76 10-109z" fill="{hair}"/>
    <path d="M202 216c17 30 36 53 65 69 3 27-7 51-25 72-17 21-35 29-52 20-12-6-17-19-16-33l-20-9 26-28c-5-35 2-67 22-91z" fill="{face}"/>
    <path d="M213 192c15 43 35 80 68 113l-12-88-28-28z" fill="{ink}"/>
    <path d="M303 284c11-10 25-9 31 2 7 14-3 31-20 35l-21 3 3-22z" fill="{face}"/>
    <path d="M354 306c24-8 47 6 55 31l24 79c-44 19-91 21-133 11l-87-27c-8-2-8-12 0-14l65-17 47-48c9-8 18-12 29-15z" fill="{face}" stroke="{ink}" stroke-width="11" stroke-linejoin="round"/>
    <path d="M278 370l-48 19 69 18" fill="none" stroke="{hair}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
    {small}
    </g>'''

def svg(body, title, background=None):
    base = '' if background is None else f'<rect x="48" y="48" width="416" height="416" rx="96" fill="{background}"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512" role="img" aria-labelledby="title"><title id="title">{title}</title>{base}{body}</svg>\n'

assets = ROOT / 'assets'
assets.mkdir(exist_ok=True)
(assets/'aimy-mark.svg').write_text(svg(artwork(), 'Aimy 猫耳侧脸品牌标记'))
(assets/'aimy-mark-compact.svg').write_text(svg(artwork('#CE7094','#CE7094',compact=True), 'Aimy 小尺寸品牌标记'))
(assets/'aimy-icon-light.svg').write_text(svg(artwork(), 'Aimy 粉雾应用图标', '#FFF9FC'))
(assets/'aimy-icon-dark.svg').write_text(svg(artwork('#D995B1','#F3B9CF','#30222E'), 'Aimy 夜间应用图标', '#30222E'))
(assets/'aimy-icon-rose.svg').write_text(svg(artwork('#FBE6EF','#FFF9FC','#CE7094'), 'Aimy 莓粉应用图标', '#CE7094'))
(assets/'aimy-icon-compact.svg').write_text(svg(artwork('#CE7094','#CE7094',compact=True), 'Aimy 小尺寸应用图标', '#FFF9FC'))

# A separate single-color shape, suitable for a macOS template image. No
# white tile or two-tone picture is embedded in this asset.
template = '''<path d="M8 10 7 4l5 3c2-1 4-1 6 0l5-4v7c5 4 7 10 4 15-2 4-7 6-12 5l-5-2-6-1 5-5-3-2 3-4c-1-2-1-4-1-6zm4 3c-1 3-1 5 0 7l-2 2 3 1c4 1 7-1 9-5-5 1-7-2-10-5z" fill="currentColor" fill-rule="evenodd"/>'''
(assets/'aimy-tray-template.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" role="img" aria-label="Aimy">{template}</svg>\n')

glyphs = {
 'chat':'<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 10h8M8 14h5"/>',
 'mic':'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
 'mic-off':'<path d="m3 3 18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9V5a3 3 0 0 0-5.8-1M5 10v2a7 7 0 0 0 12 4.9M19 10v2c0 .7-.1 1.4-.3 2M12 19v3M8 22h8"/>',
 'screen':'<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/>',
 'settings':'<path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
 'arrow':'<path d="M12 19V5m-6 6 6-6 6 6"/>',
 'chevron':'<path d="m9 5 7 7-7 7"/>',
 'back':'<path d="m14 5-7 7 7 7"/>',
 'plus':'<path d="M12 5v14M5 12h14"/>',
 'check':'<path d="m5 12 4 4L19 6"/>',
 'close':'<path d="m6 6 12 12M18 6 6 18"/>',
 'moon':'<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>',
 'sun':'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
 'image':'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
 'volume':'<path d="m11 5-6 4H2v6h3l6 4ZM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
 'shield':'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
 'key':'<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-3-3 3-3m-6 0 3-3"/>',
 'heart':'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
 'download':'<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
 'pause':'<path d="M8 5v14M16 5v14"/>',
 'refresh':'<path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.5-2L20 8M4 16l2.4 3a7 7 0 0 0 11.5-2"/>',
 'memory':'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h4"/>',
 'expand':'<path d="M8 3H3v5M16 21h5v-5M3 3l6 6M21 21l-6-6"/>',
 'move':'<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
 'warning':'<path d="m12 3 10 18H2L12 3ZM12 9v5M12 17h.01"/>',
 'link':'<path d="m10 13 4-4M8 15l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0) scale(.92)"/>',
}
sprite = ''.join(f'<symbol id="i-{key}" viewBox="0 0 24 24">{value}</symbol>' for key,value in glyphs.items())
(assets/'ui-icons.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg"><defs>{sprite}</defs></svg>\n')
for key,value in glyphs.items():
    d=assets/'ui-icons'; d.mkdir(exist_ok=True)
    (d/f'{key}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{value}</svg>\n')

tokens = {
 'meta':{'name':'Aimy · 粉雾','version':'0.1.0','date':'2026-10-12','status':'design_proposal','reference':'user provided image + Refero bundled craft + AIRI existing screen evidence'},
 'primitive':{'rose':{'50':'#FFF3F7','100':'#FBE6EF','200':'#F2CADB','300':'#EDBED0','400':'#D78BA9','500':'#CE7094','600':'#B44870','700':'#9B3A60','800':'#81304F','900':'#562238'}},
 'light':{'canvas':'#FCF9FA','surface':'#FFFFFF','surfaceSoft':'#F6F1F4','surfaceRaised':'#FFFFFF','text':'#372F36','textSecondary':'#73646E','textMuted':'#7E6D78','border':'#E7DDE3','controlBorder':'#9B8994','primary':'#B44870','primaryHover':'#9B3A60','primaryPressed':'#81304F','onPrimary':'#FFFFFF','primarySoft':'#FBE6EF','primaryText':'#9B3A60','focus':'#9B3A60','success':'#326C59','successSoft':'#EAF4EF','warning':'#865C21','warningSoft':'#FFF3DC','danger':'#B13E4C','dangerSoft':'#FDECEF','disabled':'#EDE5EA','onDisabled':'#8B7A85'},
 'dark':{'canvas':'#211C23','surface':'#2A242D','surfaceSoft':'#332B35','surfaceRaised':'#3B303C','text':'#F8EDF3','textSecondary':'#C5B2BF','textMuted':'#B7A1B0','border':'#4C3C49','controlBorder':'#9B8293','primary':'#F1A9C5','primaryHover':'#F7C1D6','primaryPressed':'#E28BAF','onPrimary':'#34212D','primarySoft':'#49303D','primaryText':'#F3B9CF','focus':'#F1A9C5','success':'#A2D6BE','successSoft':'#233C32','warning':'#E8C082','warningSoft':'#423524','danger':'#FFA7B6','dangerSoft':'#472B35','disabled':'#453743','onDisabled':'#A68E9F'},
 'font':{'family':'-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif','mono':'"SFMono-Regular", Menlo, Consolas, monospace','size':{'caption':12,'small':13,'body':14,'message':15,'section':20,'title':28,'display':48},'lineHeight':{'compact':1.3,'body':1.6,'message':1.8},'weight':{'normal':400,'medium':500,'semibold':600}},
 'space':[4,8,12,16,20,24,32,40,48,64],
 'radius':{'small':8,'control':12,'bubble':18,'panel':24,'pill':999},
 'motion':{'fast':120,'normal':180,'slow':260,'easing':'cubic-bezier(.2,.8,.2,1)','reducedMotion':'no decorative transforms or continuous motion'},
 'control':{'height':40,'touchHeight':44,'iconSize':20,'stroke':1.8,'focusWidth':3,'focusOffset':3},
 'layout':{'chatWindow':{'minWidth':360,'preferredWidth':500},'settingsWindow':{'preferredWidth':920,'sidebar':208,'contentMax':680},'stage':'separate transparent character window; do not combine into a dashboard'}
}
(ROOT/'tokens.json').write_text(json.dumps(tokens,ensure_ascii=False,indent=2)+'\n')

def kebab(s):
    import re
    return re.sub(r'([A-Z])',lambda m:'-'+m.group(1).lower(),s)
css='/* Aimy 粉雾 0.1 — 2026-10-12 — design proposal */\n'
for selector,key in [(':root','light'),('[data-theme="dark"]','dark')]:
    css+=selector+' {\n  color-scheme: '+('light' if key=='light' else 'dark')+';\n'
    for name,value in tokens[key].items(): css+=f'  --{kebab(name)}: {value};\n'
    css+='}\n'
css+=':root {\n'
css+=f'  --font: {tokens["font"]["family"]};\n  --font-mono: {tokens["font"]["mono"]};\n'
for key,value in tokens['radius'].items():css+=f'  --radius-{key}: {value}px;\n'
for value in tokens['space']:css+=f'  --space-{value}: {value}px;\n'
css+='  --shadow-panel: 0 16px 48px #52344712, 0 2px 6px #52344706;\n  --ease: cubic-bezier(.2,.8,.2,1);\n  --duration: 180ms;\n}\n[data-theme="dark"] { --shadow-panel: 0 16px 48px #00000030; }\n'
(ROOT/'tokens.css').write_text(css)
print(f'Created 7 brand vectors, {len(glyphs)} UI glyphs, and light/dark design tokens.')
