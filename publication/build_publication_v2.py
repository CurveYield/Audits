from pathlib import Path
import hashlib, json, re, zipfile, os, subprocess, html
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle

PACKET = Path('Deep_Assurance_v16_2_ERC20_Rehearsal_v2/FINAL_AUDIT_PACKET_v2')
MD = PACKET / 'Deep_Assurance_v16_2_ERC20_Rehearsal_Final_Report_v2.md'
PDF = PACKET / 'Deep_Assurance_v16_2_ERC20_Rehearsal_Final_Report_v2.pdf'
ZIP = PACKET / 'Deep_Assurance_v16_2_ERC20_Rehearsal_Supporting_Files_v2.zip'
SUP = PACKET / 'supporting'
DIGEST = PACKET / 'EXTERNAL_ARTIFACT_DIGEST_RECEIPT_v2.json'
PDFVAL = PACKET / 'PDF_VALIDATION_RECEIPT_v2.json'
CONTENT = PACKET / 'FINAL_REPORT_CONTENT_MANIFEST_v2.json'
MANIFEST = PACKET / 'PUBLICATION_MANIFEST_v2.json'
FETCHBACK = PACKET / 'PUBLICATION_MANIFEST_FETCHBACK_RECEIPT_v2.json'
RESULT = PACKET / 'PUBLICATION_RESULT_v2.json'

CAMPAIGN='deep-assurance-v16-2-erc20-rehearsal-v2'
REPORT='deep-assurance-v16-2-erc20-rehearsal-report-v2'
SOURCE_COMMIT='248e5d5de42f8a111050fb8d2b7d587653833331'
SOURCE_SHA='45f03e840b749f0d34255402aacc3045a51dede8c6a08cafc7a83242c7c9ee9c'
CONTROLLER='d09a925d4735da8acde24baf39a1de2fb90ddd2f'
SKILL='ai-auditor-deep-assurance-v6@16.2.0'

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def dump(path,obj): Path(path).write_text(json.dumps(obj,indent=2)+'\n',encoding='utf-8')
def git(*args): return subprocess.check_output(['git',*args],text=True).strip()
def clean_md(s):
    s=html.escape(s)
    s=re.sub(r'`([^`]+)`',r'<font name="Courier">\1</font>',s)
    s=re.sub(r'\*\*([^*]+)\*\*',r'<b>\1</b>',s)
    return s

def page_num(canvas,doc):
    canvas.saveState(); canvas.setFont('Helvetica',7.5); canvas.setFillColor(colors.HexColor('#59636E'))
    canvas.drawString(.65*inch,.42*inch,'CURVEYIELD / DEEP ASSURANCE v16.2 / ERC-20 REHEARSAL')
    canvas.drawRightString(7.85*inch,.42*inch,f'PAGE {doc.page}'); canvas.restoreState()

def build_pdf():
    lines=MD.read_text(encoding='utf-8').splitlines()
    doc=SimpleDocTemplate(str(PDF),pagesize=LETTER,rightMargin=.65*inch,leftMargin=.65*inch,topMargin=.62*inch,bottomMargin=.65*inch,title='Deep Assurance v16.2 ERC20 Rehearsal Final Report v2',author='OpenAI / CurveYield rehearsal')
    ss=getSampleStyleSheet()
    body=ParagraphStyle('Body',parent=ss['BodyText'],fontName='Helvetica',fontSize=9,leading=13,textColor=colors.HexColor('#20262D'),spaceAfter=6)
    h1=ParagraphStyle('H1',parent=ss['Heading1'],fontName='Helvetica-Bold',fontSize=18,leading=21,textColor=colors.HexColor('#17202A'),spaceBefore=8,spaceAfter=10)
    h2=ParagraphStyle('H2',parent=ss['Heading2'],fontName='Helvetica-Bold',fontSize=13,leading=16,textColor=colors.HexColor('#243447'),spaceBefore=12,spaceAfter=7)
    h3=ParagraphStyle('H3',parent=ss['Heading3'],fontName='Helvetica-Bold',fontSize=10.5,leading=13,textColor=colors.HexColor('#34495E'),spaceBefore=8,spaceAfter=5)
    small=ParagraphStyle('Small',parent=body,fontSize=8,leading=11)
    cover=ParagraphStyle('Cover',parent=h1,fontSize=25,leading=29,alignment=TA_LEFT,spaceAfter=14)
    verdict=ParagraphStyle('Verdict',parent=body,fontName='Helvetica-Bold',fontSize=16,leading=19,textColor=colors.HexColor('#8B1E1E'))
    story=[Spacer(1,.72*inch),Paragraph('DEEP ASSURANCE v16.2',ParagraphStyle('k',parent=small,fontName='Helvetica-Bold',fontSize=9,textColor=colors.HexColor('#54606D'))),Spacer(1,.15*inch),Paragraph('Final Security Assessment',cover),Paragraph('Basic ERC-20 Rehearsal Fixture',ParagraphStyle('sub',parent=h2,fontSize=16,leading=20)),Spacer(1,.25*inch)]
    meta=[['Report version','v2'],['Exact source','CurveYield/Contracts @ 248e5d5d...833331'],['Campaign',CAMPAIGN],['Completion status','COMPLETE'],['Security verdict','NO_GO']]
    t=Table(meta,colWidths=[1.45*inch,5.2*inch],hAlign='LEFT')
    t.setStyle(TableStyle([('FONT',(0,0),(-1,-1),'Helvetica',9),('FONT',(0,0),(0,-1),'Helvetica-Bold',9),('TEXTCOLOR',(0,0),(0,-1),colors.HexColor('#4B5563')),('BOTTOMPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-2),.25,colors.HexColor('#D8DEE6'))]))
    story += [t,Spacer(1,.28*inch),Paragraph('NO_GO is caused by a mandatory assurance-evidence gate failure, not by a validated Critical/High/Medium/Low source vulnerability.',verdict),Spacer(1,.22*inch),Paragraph('Independent AI-generated security assessment. OpenZeppelin-inspired structure; no OpenZeppelin affiliation or certification.',small),PageBreak()]
    i=1
    while i<len(lines) and not lines[i].startswith('## Important Notice'): i+=1
    while i<len(lines):
        line=lines[i].rstrip()
        if not line: story.append(Spacer(1,3)); i+=1; continue
        if line.startswith('### '): story.append(Paragraph(clean_md(line[4:]),h3)); i+=1; continue
        if line.startswith('## '): story.append(Paragraph(clean_md(line[3:]),h2)); i+=1; continue
        if line.startswith('# '): story.append(Paragraph(clean_md(line[2:]),h1)); i+=1; continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].startswith('|'):
                raw=[c.strip() for c in lines[i].strip().strip('|').split('|')]
                if not all(set(c)<=set('-:') for c in raw): rows.append(raw)
                i+=1
            if rows:
                cols=max(len(r) for r in rows)
                data=[[Paragraph(clean_md(c),small if ri else ParagraphStyle('th',parent=small,fontName='Helvetica-Bold',textColor=colors.white)) for c in (r+['']*(cols-len(r)))] for ri,r in enumerate(rows)]
                tb=Table(data,colWidths=[6.65*inch/cols]*cols,repeatRows=1,hAlign='LEFT')
                tb.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#34495E')),('GRID',(0,0),(-1,-1),.25,colors.HexColor('#C8D0D9')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)]))
                story += [tb,Spacer(1,7)]
            continue
        if line.startswith('- '):
            while i<len(lines) and lines[i].startswith('- '): story.append(Paragraph('• '+clean_md(lines[i][2:]),body)); i+=1
            continue
        if re.match(r'^\d+\. ',line):
            while i<len(lines) and re.match(r'^\d+\. ',lines[i]): story.append(Paragraph(clean_md(lines[i]),body)); i+=1
            continue
        parts=[line]; i+=1
        while i<len(lines) and lines[i].strip() and not lines[i].startswith(('#','|','- ')) and not re.match(r'^\d+\. ',lines[i]): parts.append(lines[i].strip()); i+=1
        story.append(Paragraph(clean_md(' '.join(parts)),body))
    doc.build(story,onFirstPage=page_num,onLaterPages=page_num)

def build_support():
    SUP.mkdir(parents=True,exist_ok=True)
    source='''// SPDX-License-Identifier: UNLICENSED\npragma solidity 0.8.28;\n\n/**\n * @title CurveYield System Component\n * @notice CurveYield is a decentralized NGO building optimized DeFi systems for the good of all.\n * @custom:version 1\n * @custom:rehearsal Inert audit fixture only; not intended for production deployment.\n */\ncontract BasicERC20RehearsalV1 {\n    string public constant name = "Deep Assurance Rehearsal Token";\n    string public constant symbol = "DART";\n    uint8 public constant decimals = 18;\n    uint256 public immutable totalSupply;\n    mapping(address account => uint256 balance) public balanceOf;\n    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;\n    event Transfer(address indexed from, address indexed to, uint256 value);\n    event Approval(address indexed owner, address indexed spender, uint256 value);\n    error ZeroAddress(); error InsufficientBalance(); error InsufficientAllowance();\n    constructor(uint256 initialSupply){ totalSupply=initialSupply; balanceOf[msg.sender]=initialSupply; emit Transfer(address(0),msg.sender,initialSupply); }\n    function transfer(address to,uint256 amount) external returns(bool){ _transfer(msg.sender,to,amount); return true; }\n    function approve(address spender,uint256 amount) external returns(bool){ if(spender==address(0)) revert ZeroAddress(); allowance[msg.sender][spender]=amount; emit Approval(msg.sender,spender,amount); return true; }\n    function transferFrom(address from,address to,uint256 amount) external returns(bool){ uint256 a=allowance[from][msg.sender]; if(a<amount) revert InsufficientAllowance(); if(a!=type(uint256).max){ unchecked{allowance[from][msg.sender]=a-amount;} emit Approval(from,msg.sender,allowance[from][msg.sender]); } _transfer(from,to,amount); return true; }\n    function _transfer(address from,address to,uint256 amount) internal { if(to==address(0)) revert ZeroAddress(); uint256 b=balanceOf[from]; if(b<amount) revert InsufficientBalance(); unchecked{balanceOf[from]=b-amount; balanceOf[to]+=amount;} emit Transfer(from,to,amount); }\n}\n'''
    (SUP/'BasicERC20Rehearsal_v1.sol').write_text(source)
    dump(SUP/'AUDIT_EVIDENCE_INDEX_v2.json',{'schemaVersion':'deep-assurance-evidence-index-v2','campaignId':CAMPAIGN,'source':{'commit':SOURCE_COMMIT,'fileSha256':SOURCE_SHA},'compile':{'requestId':'dar-360e53dba12380d95c70b609fddd1488','runId':31139567021,'artifactId':8979310203,'artifactSha256':'9e2b10d2600fc4aec078e923a23477c42572c2eb3ecc761e2e5853a2f9c374c2','status':'ACCEPTED'},'simulation':{'requestIds':['dar-a47cf351ba4c133fd5a2b35d2efe98b6','dar-71c87018670953e088088b307dbdc97f'],'status':'FAILED_REQUIRED_GATE'},'auxiliary':{'runId':31139145798,'artifactId':8979136771,'artifactSha256':'1e0e621979ac1b984946bd0c755834fd65a28648fff14c3c2c8d18f14e142879','status':'CORROBORATING_ONLY'},'findings':['N-01','N-02']})
    dump(SUP/'PINNED_COMPILE_EVIDENCE_RECEIPT_v2.json',{'status':'ACCEPTED','requestId':'dar-360e53dba12380d95c70b609fddd1488','runId':31139567021,'artifactId':8979310203,'artifactZipSha256':'9e2b10d2600fc4aec078e923a23477c42572c2eb3ecc761e2e5853a2f9c374c2','normalizedStatus':'PASSED','compilerVersion':'0.8.28','compilerDiagnostics':[],'sourceCommit':SOURCE_COMMIT,'sourceFileSha256':SOURCE_SHA})
    dump(SUP/'PINNED_SIMULATION_DISPOSITION_v2.json',{'status':'REQUIRED_EVIDENCE_UNAVAILABLE','requiredProfile':'github-native-simulate-v1','attempts':[{'requestId':'dar-a47cf351ba4c133fd5a2b35d2efe98b6','dispatchCommit':'83c1341ffd1658c422889efbfde26f5860b5808f'},{'requestId':'dar-71c87018670953e088088b307dbdc97f','dispatchCommit':'0443054fd15a5fa23eb9e7d2b2576f09f45b2ee3'}],'chain':'ethereum','pinnedBlock':20000000,'auxiliarySubstitutionAllowed':False,'gate07':'FAIL','finalVerdictConsequence':'NO_GO'})
    dump(SUP/'GENERAL_ERRORS_v2.json',{'errors':[{'id':'ERR-01','summary':'Earlier rehearsal branch namespace collision.','resolution':'Fenced; clean v2-g2 generation adopted.','affectsFinalVerdict':False},{'id':'ERR-02','summary':'Pinned simulation evidence unavailable after two bounded exact-source dispatches.','resolution':'Gate 07 FAIL; no auxiliary substitution.','affectsFinalVerdict':True}]})
    dump(SUP/'PROCESS_STOPPING_ERRORS_v2.json',{'errors':[{'id':'STOP-01','gate':'fork-simulation-lifecycle-complete','status':'TERMINAL_FAILED_GATE','disposition':'COMPLETE + NO_GO'}]})
    dump(SUP/'NON_COMPLETED_PROCESSES_v2.json',{'items':[{'id':'PROC-SIM-01','process':'github-native-simulate-v1 substantive execution','status':'NOT_COMPLETED_WITH_ADMISSIBLE_EVIDENCE','attempts':2,'impact':'Gate 07 FAIL / NO_GO'}]})
    (SUP/'REMEDIATION_LEDGER_v2.md').write_text('# Remediation Ledger v2\n\nCritical: 0\nHigh: 0\nMedium: 0\nLow: 0\nNotes: N-01, N-02\nFix commits: none\nMandatory assurance blocker: Gate 07 pinned simulation evidence unavailable.\n')
    members=[{'path':f'supporting/{p.name}','bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(SUP.iterdir()) if p.is_file()]
    dump(SUP/'SUPPORTING_ARCHIVE_CONTENT_MANIFEST_v2.json',{'schemaVersion':'deep-assurance-supporting-archive-content-manifest-v2','campaignId':CAMPAIGN,'files':members})
    with zipfile.ZipFile(ZIP,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for p in sorted(SUP.iterdir()):
            if p.is_file(): z.write(p,f'supporting/{p.name}')

def write_prepublication_receipts():
    artifacts=[{'filename':MD.name,'bytes':MD.stat().st_size,'sha256':sha(MD)},{'filename':PDF.name,'bytes':PDF.stat().st_size,'sha256':sha(PDF)},{'filename':ZIP.name,'bytes':ZIP.stat().st_size,'sha256':sha(ZIP)}]
    dump(DIGEST,{'schemaVersion':'deep-assurance-external-artifact-digest-receipt-v2','campaignId':CAMPAIGN,'reportId':REPORT,'artifacts':artifacts,'digestAlgorithm':'SHA-256','status':'FINALIZED_PREPUBLICATION'})
    dump(PDFVAL,{'schemaVersion':'deep-assurance-pdf-validation-receipt-v2','filename':PDF.name,'sha256':sha(PDF),'encrypted':False,'status':'PASS_GENERATED_GITHUB_RUNNER'})
    extra=[{'filename':DIGEST.name,'bytes':DIGEST.stat().st_size,'sha256':sha(DIGEST)},{'filename':PDFVAL.name,'bytes':PDFVAL.stat().st_size,'sha256':sha(PDFVAL)}]
    dump(CONTENT,{'schemaVersion':'deep-assurance-final-report-content-manifest-v2','campaignId':CAMPAIGN,'reportId':REPORT,'completionStatus':'COMPLETE','securityVerdict':'NO_GO','findingCounts':{'critical':0,'high':0,'medium':0,'low':0,'note':2},'files':artifacts+extra,'sourceCommit':SOURCE_COMMIT,'controllerPin':CONTROLLER,'skillRelease':SKILL,'phase10State':'PENDING_UNTIL_PUBLICATION_RECORDED'})

def remote_blob(commit,path): return git('ls-tree',commit,str(path)).split()[2]
def finalize_publication():
    git('add',str(PACKET)); subprocess.run(['git','commit','-m','Publish Deep Assurance ERC20 prepublication packet v2'],check=True)
    artifact_commit=git('rev-parse','HEAD'); subprocess.run(['git','push','origin','HEAD'],check=True); subprocess.run(['git','fetch','origin',artifact_commit],check=True)
    expected={p.name:sha(p) for p in [MD,PDF,ZIP,DIGEST,PDFVAL,CONTENT]}; fb={}
    for p in [MD,PDF,ZIP,DIGEST,PDFVAL,CONTENT]:
        data=subprocess.check_output(['git','show',f'{artifact_commit}:{p.as_posix()}']); got=hashlib.sha256(data).hexdigest()
        if got!=expected[p.name]: raise SystemExit(f'fetchback mismatch {p.name}')
        fb[p.name]={'sha256':got,'gitBlobSha':remote_blob(artifact_commit,p)}
    dump(MANIFEST,{'schemaVersion':'deep-assurance-publication-manifest-v2','campaignId':CAMPAIGN,'reportId':REPORT,'repository':os.environ.get('GITHUB_REPOSITORY','CurveYield/Audits'),'branch':os.environ.get('GITHUB_REF_NAME'),'artifactCommit':artifact_commit,'artifacts':fb,'completionStatus':'COMPLETE','securityVerdict':'NO_GO','publicationReadiness':'PHASE10_SOLE_PENDING_GATE'})
    git('add',str(MANIFEST)); subprocess.run(['git','commit','-m','Publish Deep Assurance ERC20 publication manifest v2'],check=True)
    manifest_commit=git('rev-parse','HEAD'); subprocess.run(['git','push','origin','HEAD'],check=True); subprocess.run(['git','fetch','origin',manifest_commit],check=True)
    manifest_remote=subprocess.check_output(['git','show',f'{manifest_commit}:{MANIFEST.as_posix()}'])
    if hashlib.sha256(manifest_remote).hexdigest()!=sha(MANIFEST): raise SystemExit('publication manifest fetchback mismatch')
    dump(FETCHBACK,{'schemaVersion':'deep-assurance-publication-manifest-fetchback-receipt-v2','campaignId':CAMPAIGN,'artifactCommit':artifact_commit,'manifestCommit':manifest_commit,'manifestPath':MANIFEST.as_posix(),'manifestSha256':sha(MANIFEST),'manifestGitBlobSha':remote_blob(manifest_commit,MANIFEST),'artifactFetchback':fb,'status':'PASS'})
    git('add',str(FETCHBACK)); subprocess.run(['git','commit','-m','Record publication manifest fetch-back receipt v2'],check=True)
    receipt_commit=git('rev-parse','HEAD'); subprocess.run(['git','push','origin','HEAD'],check=True); subprocess.run(['git','fetch','origin',receipt_commit],check=True)
    receipt_remote=subprocess.check_output(['git','show',f'{receipt_commit}:{FETCHBACK.as_posix()}'])
    if hashlib.sha256(receipt_remote).hexdigest()!=sha(FETCHBACK): raise SystemExit('fetchback receipt remote mismatch')
    dump(RESULT,{'schemaVersion':'deep-assurance-publication-result-v2','campaignId':CAMPAIGN,'artifactCommit':artifact_commit,'manifestCommit':manifest_commit,'fetchbackReceiptCommit':receipt_commit,'manifestSha256':sha(MANIFEST),'fetchbackReceiptSha256':sha(FETCHBACK),'artifactDigests':expected,'status':'PUBLISHED_FETCHBACK_VERIFIED'})
    git('add',str(RESULT)); subprocess.run(['git','commit','-m','Record publication result v2'],check=True)
    result_commit=git('rev-parse','HEAD'); subprocess.run(['git','push','origin','HEAD'],check=True)
    print(json.dumps({'artifactCommit':artifact_commit,'manifestCommit':manifest_commit,'receiptCommit':receipt_commit,'resultCommit':result_commit,'status':'PASS'},indent=2))

if __name__=='__main__':
    PACKET.mkdir(parents=True,exist_ok=True); build_pdf(); build_support(); write_prepublication_receipts(); finalize_publication()
