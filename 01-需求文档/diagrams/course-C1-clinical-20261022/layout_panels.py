"""Align PlantUML-rendered panels without changing any UML shapes or text."""
from pathlib import Path
import re,json
W=Path(__file__).resolve().parent;S=W/'图源' if (W/'图源').exists() else W;out=[]
for num,rows in [(2,[['H','R'],['D','P']]),(3,[['T','C','E']])]:
    panels={}
    for row in rows:
        for key in row:
            stem=f'analysis-entities-{num}-panel-{key}';s=(S/f'{stem}.svg').read_text('utf-8');s=s[s.index('<svg'):]
            width=float(re.search(r'\bwidth="([\d.]+)(?:px)?"',s).group(1));height=float(re.search(r'\bheight="([\d.]+)(?:px)?"',s).group(1))
            for ident in set(re.findall(r'\bid="([^"]+)"',s)):
                s=s.replace('id="'+ident+'"','id="'+key+'_'+ident+'"').replace('#'+ident,'#'+key+'_'+ident)
            panels[key]=(s,width,height,stem)
    gap=45;cols=len(rows[0]);col_widths=[max(panels[row[c]][1] for row in rows) for c in range(cols)]
    row_heights=[max(panels[key][2] for key in row) for row in rows];width=sum(col_widths)+gap*(cols-1)+20;height=sum(row_heights)+gap*(len(rows)-1)+20
    svg=[f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{width}px" height="{height}px" viewBox="0 0 {width} {height}">','<rect width="100%" height="100%" fill="white"/>']
    placed=[];y=10
    for ri,row in enumerate(rows):
        x=10
        for ci,key in enumerate(row):
            s,w,h,stem=panels[key];svg.append(f'<g transform="translate({x},{y})">{s}</g>');placed.append(dict(stem=stem,x=x,y=y,width=w,height=h));x+=col_widths[ci]+gap
        y+=row_heights[ri]+gap
    svg.append('</svg>');(S/f'analysis-entities-{num}.svg').write_text('\n'.join(svg),'utf-8')
    out.append(dict(stem=f'analysis-entities-{num}',width=width,height=height,panels=placed,method='PlantUML分区矢量输出，等字号对齐拼版；不改变类框、文字、连线或关系'))
(W/'版面配置.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n','utf-8');print([(j['stem'],j['width'],j['height']) for j in out])
