from pathlib import Path
import re, json, hashlib, zipfile
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import LETTER
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics

ROOT = Path('deep-assurance-v16-2-erc20-rehearsal-v1')
SRC_PACKET = ROOT / 'FINAL_AUDIT_PACKET_v1'
OUT_PACKET = ROOT / 'FINAL_AUDIT_PACKET_v3'
OUT_PACKET.mkdir(parents=True, exist_ok=True)

MD_SRC = SRC_PACKET / 'Deep_Assurance_v16_2_ERC20_Rehearsal_Final_Report_v1.md'
MD_OUT = OUT_PACKET / 'Deep_Assurance_v16_2_ERC20_Rehearsal_Final_Report_v1.md'
PDF_OUT = OUT_PACKET / 'Deep_Assurance_v16_2_ERC20_Rehearsal_Final_Report_v3.pdf'
ZIP_OUT = OUT_PACKET / 'Deep_Assurance_v16_2_ERC20_Rehearsal_Supporting_Files_v3.zip'
RESULT_OUT = OUT_PACKET / 'PUBLICATION_WORKFLOW_RESULT_v3.json'

md = MD_SRC.read_text(encoding='utf-8')
MD_OUT.write_text(md, encoding='utf-8', newline='\n')

W,H = LETTER; left=48; right=48; top=54; bottom=42
c = canvas.Canvas(str(PDF_OUT), pagesize=LETTER, pageCompression=1, invariant=1)
c.setTitle('Deep Assurance v16.2 ERC-20 Rehearsal Audit')
c.setAuthor('CurveYield / ChatGPT')
page=1; y=H-top

def footer():
    c.setStrokeColor(colors.HexColor('#D8E0E8')); c.line(left,30,W-right,30)
    c.setFont('Helvetica',7); c.setFillColor(colors.HexColor('#6B7785'))
    c.drawString(left,18,'Deep Assurance v16.2 ERC-20 Rehearsal - publication v3')
    c.drawRightString(W-right,18,f'Page {page}')

def newpage():
    global y,page
    footer(); c.showPage(); page+=1; y=H-top

def wrap(s,size=9.2,bold=False,indent=0):
    font='Helvetica-Bold' if bold else 'Helvetica'; maxw=W-left-right-indent
    words=s.split(); lines=[]; cur=''
    for w in words:
        cand=(cur+' '+w).strip()
        if pdfmetrics.stringWidth(cand,font,size)<=maxw: cur=cand
        else:
            if cur: lines.append(cur)
            if pdfmetrics.stringWidth(w,font,size)>maxw:
                chunk=''
                for ch in w:
                    if pdfmetrics.stringWidth(chunk+ch,font,size)<=maxw: chunk+=ch
                    else: lines.append(chunk); chunk=ch
                cur=chunk
            else: cur=w
    if cur: lines.append(cur)
    return lines

def draw_lines(lines,size=9.2,leading=12,font='Helvetica',color='#2D3742',indent=0,space_after=4):
    global y
    for line in lines:
        if y<bottom+leading+16: newpage()
        c.setFont(font,size); c.setFillColor(colors.HexColor(color)); c.drawString(left+indent,y,line); y-=leading
    y-=space_after

# cover
c.setFillColor(colors.HexColor('#132B4F')); c.setFont('Helvetica-Bold',26); c.drawString(left,H-150,'DEEP ASSURANCE v6')
c.setFont('Helvetica-Bold',23); c.drawString(left,H-190,'ERC-20 Rehearsal Audit')
c.setFillColor(colors.HexColor('#41698C')); c.setFont('Helvetica',14); c.drawString(left,H-220,'BasicERC20RehearsalV1')
c.setFillColor(colors.HexColor('#1F7A55')); c.setFont('Helvetica-Bold',16); c.drawString(left,H-275,'PASS')
c.setFillColor(colors.HexColor('#2D3742')); c.setFont('Helvetica',10)
for i,t in enumerate(['completionStatus: COMPLETE','Exact source: CurveYield/Contracts @ 248e5d5de42f8a111050fb8d2b7d587653833331','Environment: Ethereum fork - block 20,000,000','Date: August 6, 2026','Prepared for CurveYield']): c.drawString(left,H-305-i*22,t)
c.setFont('Helvetica',8); c.setFillColor(colors.HexColor('#6B7785')); c.drawString(left,65,'Point-in-time AI-generated security assessment. No OpenZeppelin affiliation or certification.')
newpage()

# TOC
c.setFont('Helvetica-Bold',18); c.setFillColor(colors.HexColor('#132B4F')); c.drawString(left,y,'Table of Contents'); y-=32
for title,p in [('Important Notice and Engagement Metadata',3),('Executive Summary',4),('Exact Source',5),('Scope',5),('Methodology and Assurance Boundaries',6),('System Overview',7),('Security Considerations and Threat Model',7),('Findings Summary',8),('Notes & Additional Information',8),('Remediation Review',9),('Phase Results',10),('Lane Results',11),('Findings / Error Records / Limitations',12),('Evidence Index',14),('Conclusion',15),('Final Delivery Packet and Validation',16)]:
    c.setFont('Helvetica',9); c.setFillColor(colors.HexColor('#2D3742')); c.drawString(left,y,title); c.drawRightString(W-right,y,str(p)); y-=17
newpage()

c.setFont('Helvetica-Bold',14); c.setFillColor(colors.HexColor('#132B4F')); c.drawString(left,y,'Publication Artifact Revision v3'); y-=28
for t in ['Authoritative audit decisions remain frozen under report ID deep-assurance-v16-2-erc20-rehearsal-report-v1.', 'Publication v3 is generated and committed inside GitHub to preserve exact binary bytes after rejected connector binary transports.', 'Frozen Markdown v1 remains authoritative. The PDF content is rendered from that unchanged Markdown.']:
    draw_lines(wrap(t,size=9),size=9,leading=12,font='Helvetica',space_after=6)
newpage()

lines=md.splitlines(); start=next(i for i,l in enumerate(lines) if l.strip()=='## Important Notice and Engagement Metadata')
in_code=False
for raw in lines[start:]:
    s=raw.rstrip()
    if s.startswith('```'): in_code=not in_code; y-=3; continue
    if not s.strip(): y-=4; continue
    if s.startswith('## '):
        title=s[3:]
        targets={'Executive Summary':5,'Methodology and Assurance Boundaries':6,'System Overview':7,'Findings Summary':8,'Client-Reported Issues':9,'Phase Results':10,'General Errors':11,'Evidence Index':13,'Release Manifest':14,'Conclusion':15,'Final Delivery Packet':16,'Frozen Finalization Sets':17}
        if title in targets:
            while page < targets[title]: newpage()
        elif y<bottom+50: newpage()
        y-=7; draw_lines([title],size=14,leading=18,font='Helvetica-Bold',color='#132B4F',space_after=6); continue
    if s.startswith('### '):
        if y<bottom+40: newpage()
        y-=4; draw_lines([s[4:]],size=10.5,leading=14,font='Helvetica-Bold',color='#41698C',space_after=4); continue
    if s.startswith('# '): continue
    if s.startswith('|'):
        clean=' | '.join(x.strip() for x in s.strip('|').split('|'))
        if re.fullmatch(r'[-: |]+',clean): continue
        draw_lines(wrap(clean,size=6.6),size=6.6,leading=8,font='Helvetica',space_after=1); continue
    if s.startswith('- '):
        txt='- '+re.sub(r'[`*]','',s[2:]); draw_lines(wrap(txt,size=8.4,indent=8),size=8.4,leading=10.5,font='Helvetica',indent=8,space_after=1); continue
    txt=re.sub(r'[`*]','',s)
    if in_code: draw_lines(wrap(txt,size=6.4),size=6.4,leading=8,font='Courier',color='#2D3742',indent=4,space_after=1)
    else: draw_lines(wrap(txt,size=8.8),size=8.8,leading=11.2,font='Helvetica',color='#2D3742',space_after=3)
footer(); c.save()

# Build deterministic supporting archive from exact published text records and generated report.
include = [
    MD_OUT,
    PDF_OUT,
    SRC_PACKET/'EVIDENCE_INDEX_v1.json',
    SRC_PACKET/'GENERAL_ERRORS_v1.json',
    SRC_PACKET/'PROCESS_STOPPING_ERRORS_v1.json',
    SRC_PACKET/'NON_COMPLETED_PROCESSES_v1.json',
    SRC_PACKET/'LIMITATIONS_v1.json',
    SRC_PACKET/'INLINE_SUMMARY_v1.md',
]
with zipfile.ZipFile(ZIP_OUT,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in include:
        zi=zipfile.ZipInfo(p.name, date_time=(2026,8,6,17,0,0)); zi.compress_type=zipfile.ZIP_DEFLATED; zi.external_attr=0o100644<<16
        z.writestr(zi,p.read_bytes())

def ident(p):
    b=p.read_bytes()
    return {'filename':p.name,'sizeBytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'gitBlobSha1':hashlib.sha1(f'blob {len(b)}\0'.encode()+b).hexdigest()}

result={
  'schemaVersion':'deep-assurance-publication-workflow-result-v3',
  'reportId':'deep-assurance-v16-2-erc20-rehearsal-report-v1',
  'sourceCommit':'248e5d5de42f8a111050fb8d2b7d587653833331',
  'finalizationSnapshotSha256':'c5a86a09fcdf9ae74ebcd0ccf618b7f45ee6b756c5197b47fcdb3c6ccdbe7305',
  'completionStatus':'COMPLETE','securityVerdict':'PASS',
  'artifacts':[ident(MD_OUT),ident(PDF_OUT),ident(ZIP_OUT)],
  'pdfPageTarget':17,
  'publicationRevision':'v3',
  'note':'Generated and committed entirely inside GitHub Actions; no connector binary transcoding.'
}
RESULT_OUT.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,indent=2))
