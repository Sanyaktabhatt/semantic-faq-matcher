from html import escape
W, H = 1200, 1290
out = []
FONT = 'font-family="Arial, Helvetica, sans-serif"'
def text(x, y, s, size=15, weight='normal', anchor='middle', color='#1f2d27'):
    lines = s.split('\n'); lh = size * 1.3; y0 = y - (len(lines) - 1) * lh / 2
    for i, line in enumerate(lines):
        out.append(f'<text x="{x}" y="{y0 + i*lh + size*0.35:.1f}" {FONT} font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" fill="{color}">{escape(line)}</text>')
def box(x, y, w, h, s, fill='#ffffff', stroke='#4d6b5d'):
    out.append(f'<rect x="{x-w/2}" y="{y-h/2}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1.8"/>'); text(x, y, s)
def term(x, y, s, w=170, h=46):
    out.append(f'<rect x="{x-w/2}" y="{y-h/2}" width="{w}" height="{h}" rx="{h/2}" fill="#147d58" stroke="#0f5e42" stroke-width="1.8"/>'); text(x, y, s, 16, 'bold', color='#ffffff')
def io(x, y, w, h, s):
    k = 18; pts = f'{x-w/2+k},{y-h/2} {x+w/2+k},{y-h/2} {x+w/2-k},{y+h/2} {x-w/2-k},{y+h/2}'
    out.append(f'<polygon points="{pts}" fill="#eef3f0" stroke="#4d6b5d" stroke-width="1.8"/>'); text(x, y, s)
def diamond(x, y, w, h, s):
    pts = f'{x},{y-h/2} {x+w/2},{y} {x},{y+h/2} {x-w/2},{y}'
    out.append(f'<polygon points="{pts}" fill="#fbf6ea" stroke="#b08a3c" stroke-width="1.8"/>'); text(x, y, s, 14.5)
def edge(points, label=None, at=0, dx=10, dy=-8, head=True):
    d = ' '.join(f'{px},{py}' for px, py in points)
    marker = ' marker-end="url(#arrow)"' if head else ''
    out.append(f'<polyline points="{d}" fill="none" stroke="#2f4a3e" stroke-width="1.8"{marker}/>')
    if label:
        (x1, y1) = points[at]; text(x1 + dx, y1 + dy, label, 14, 'bold', anchor='start', color='#8a5a00' if label == 'No' else '#0f5e42')

M, R1, R2 = 380, 790, 1085
term(M, 40, 'Start')
io(M, 128, 360, 62, 'User types a question\n(optionally selects a category)')
diamond(M, 245, 230, 104, 'Question\nempty?')
box(R1, 245, 250, 58, 'Ask the user to\nenter a question')
term(R1, 335, 'Stop', 130, 40)
box(M, 370, 360, 60, 'Encode the query with all-MiniLM-L6-v2\n→ 384-dimensional normalised vector')
box(M, 460, 360, 60, 'Cosine similarity with all 968 phrasings;\nkeep the best phrasing for each FAQ')
box(M, 550, 360, 60, 'BM25 keyword score for each FAQ;\nscore = 0.85·semantic + 0.15·keyword')
box(M, 640, 360, 60, 'Apply category filter (if chosen), rank FAQs,\nkeep top 3, predict the category')
diamond(M, 768, 250, 116, 'Top score ≥\nthreshold (0.45)?')
diamond(R1, 768, 250, 116, 'Top score <\n0.75 × threshold?')
box(R2, 768, 220, 70, '“Out of scope” message;\nlog as knowledge gap', fill='#fdf1ef', stroke='#b35a4b')
box(M, 900, 360, 66, 'Show answer, source FAQ and confidence;\n“Also close” if top two within 0.04')
box(R1, 900, 300, 66, 'No confident match: show\n“Did you mean…” (top 3); log gap')
diamond(M, 1030, 240, 104, 'User marks the\nanswer helpful?')
diamond(R1, 1030, 240, 104, 'User picks a\nsuggestion?')
box(585, 1145, 330, 60, 'Learn: embed the query and add it as\na new phrasing of that FAQ', fill='#e3f1e9', stroke='#147d58')
term(585, 1240, 'End')

edge([(M, 63), (M, 97)])
edge([(M, 159), (M, 193)])
edge([(M + 115, 245), (R1 - 125, 245)], 'Yes', 0, 12, -10)
edge([(R1, 274), (R1, 315)])
edge([(M, 297), (M, 340)], 'No', 0, 10, 14)
edge([(M, 400), (M, 430)]); edge([(M, 490), (M, 520)]); edge([(M, 580), (M, 610)])
edge([(M, 670), (M, 710)])
edge([(M + 125, 768), (R1 - 125, 768)], 'No', 0, 12, -10)
edge([(R1 + 125, 768), (R2 - 110, 768)], 'Yes', 0, 10, -10)
edge([(R1, 826), (R1, 867)], 'No', 0, 10, 14)
edge([(M, 826), (M, 867)], 'Yes', 0, 10, 14)
edge([(M, 933), (M, 978)])
edge([(R1, 933), (R1, 978)])
edge([(M, 1082), (M, 1145), (420, 1145)], 'Yes', 0, 10, 16)
edge([(R1, 1082), (R1, 1145), (750, 1145)], 'Yes', 0, 10, 16)
edge([(585, 1175), (585, 1217)])
edge([(M - 120, 1030), (130, 1030), (130, 1240), (500, 1240)], 'No', 0, -34, -10)
edge([(R1 + 120, 1030), (R2, 1030)], 'No', 0, 10, -10, head=False)
edge([(R2, 803), (R2, 1240), (670, 1240)])

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#2f4a3e"/></marker></defs>
<rect width="100%" height="100%" fill="#ffffff"/>
{chr(10).join(out)}
</svg>'''
open('flow.html', 'w').write(f'<!doctype html><html><head><meta charset="utf-8"><title>Flowchart</title><style>body{{margin:0;background:#fff}}</style></head><body>{svg}</body></html>')
print('ok')
