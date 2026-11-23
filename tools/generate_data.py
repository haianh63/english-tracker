#!/usr/bin/env python3
"""Rebuild assets/data.js and assets/manifest.json using existing original files.
No changes are made to any exercise/*.html or course_content.txt file.
Run from any directory: python tools/generate_data.py
"""
from pathlib import Path
import json,re,unicodedata,difflib
OUT=Path(__file__).resolve().parent.parent
configs={
 'master-english-intermediate':('Master English Intermediate','Ngữ pháp, giao tiếp & kỹ năng nền tảng','Intermediate','blue'),
 'master-english-vocabulary':('Master English Vocabulary','Từ vựng theo chủ đề, collocations & idioms','Vocabulary','purple'),
 'master-english-conversation-upper-intermediate-level':('Master English Conversation – Upper Intermediate','Ngữ pháp & giao tiếp trình độ trên trung cấp','Upper Intermediate','orange'),
}

rx_time=re.compile(r'^\d{1,2}:\d{2}(?::\d{2})?$')
rx_filename=re.compile(r'^\d+\s+',re.I)
def norm(s):
    s=unicodedata.normalize('NFKD',s).lower().replace('&','and')
    s=re.sub(r'^(quiz\s+)', '',s)
    s=re.sub(r'[^a-z0-9]+','',s)
    return s

def seconds(s):
    if not s:return None
    out=0
    for p in s.split(':'):out=out*60+int(p)
    return out

courses=[]; lessons=[]; exercises=[]
for slug,(title,desc,level,color) in configs.items():
    base=OUT/'exercise'/slug
    lines=[s.strip() for s in (base/'course_content.txt').read_text(encoding='utf-8-sig').splitlines() if s.strip()]
    header=lines[1]
    expected=re.findall(r'(\d+)\s+bài giảng',header)
    lec=[]
    for i,s in enumerate(lines[2:],start=2):
        if rx_time.match(s) and i>=1:
            lectitle=lines[i-1]
            # only times are timeline annotations; most titles are previous item.
            lec.append({'id':f'{slug}:lesson:{len(lec)+1:03d}',
                        'courseId':slug,'index':len(lec)+1,'title':lectitle,
                        'duration':s,'durationSeconds':seconds(s),
                        'exerciseIds':[],'section':'Nội dung bổ sung','sectionOrder':999})
        elif slug.endswith('upper-intermediate-level') and re.match(r'^QUIZ\s+\d+$',s,re.I):
            if lec:lec[-1]['pendingQuiz']=s
    if len(lec)<int(expected[0]):
        # Upper-intermediate has a listed BONUS without duration.
        for s in lines[2:]:
            if s.upper().startswith('BONUS:') and not any(x['title']==s for x in lec):
                lec.append({'id':f'{slug}:lesson:{len(lec)+1:03d}',
                    'courseId':slug,'index':len(lec)+1,'title':s,
                    'duration':None,'durationSeconds':None,'exerciseIds':[],
                    'section':'Nội dung bổ sung','sectionOrder':999})
    htmlfiles=sorted(base.rglob('*.html'),key=lambda p:p.as_posix().lower())
    files=[]
    for p in htmlfiles:
        label=rx_filename.sub('',p.stem).strip()
        rel=p.relative_to(OUT).as_posix()
        sec=p.parent.name
        order_match=re.match(r'^(\d+)',sec)
        files.append({'id':rel,'courseId':slug,'title':label,
            'fileName':p.name,'path':rel,'section':sec,
            'sectionOrder':int(order_match.group(1)) if order_match else 900,
            'kind':'quiz' if 'quiz' in label.lower() else 'exercise',
            'lessonId':None})
    # Upper: exact quiz numbers from course_content.txt
    byquiz={norm(f['title']):f for f in files}
    if slug.endswith('upper-intermediate-level'):
        for lesson in lec:
            q=lesson.pop('pendingQuiz',None)
            if q and norm(q) in byquiz:
                f=byquiz[norm(q)]
                f['lessonId']=lesson['id']
                lesson['exerciseIds'].append(f['id'])
    else:
        # Match exercises to course content title (not numeric filename prefix).
        for f in files:
            exnorm=norm(f['title'])
            exact=[l for l in lec if norm(l['title'])==exnorm]
            if exact:
                hit=exact[0]
            else:
                pool=[]
                for l in lec:
                    li=norm(l['title'])
                    ratio=difflib.SequenceMatcher(None, exnorm,li).ratio()
                    if exnorm and li and (exnorm.startswith(li) or li.startswith(exnorm)):
                        ratio=max(ratio,0.87)
                    pool.append((ratio, l))
                v,hit=max(pool,key=lambda x:x[0])
                if v<0.77:hit=None
            if hit:
                f['lessonId']=hit['id']
                hit['exerciseIds'].append(f['id'])
    byid={l['id']:l for l in lec}
    for f in files:
        if f['lessonId']:
            l=byid[f['lessonId']]
            # Use group of first matching exercise for lecture, others should same folder.
            l['section']=f['section']
            l['sectionOrder']=f['sectionOrder']
    # Section assignment for intermediate chapters with no exercise should reflect position.
    if slug=='master-english-intermediate':
        for l in lec:
            if l['sectionOrder']==999 and 'Scarlet Letter - Chapter 3' in l['title']:
                l['section']='03 Present Perfect V Past Simple, Comparatives and Superlatives, Money, Transport';l['sectionOrder']=3
            elif l['sectionOrder']==999 and 'Scarlet Letter - Chapter 4' in l['title']:
                l['section']='04 Perfect Simple V Perfect Continuous, Health, Reported Speech';l['sectionOrder']=4
    courses.append({'id':slug,'title':title,'description':desc,'level':level,'color':color,
                    'sourceHeader':header,'sourceLessonCount':int(expected[0]),
                    'lessonCount':len(lec),'exerciseCount':len(files),'sourcePath':f'exercise/{slug}/course_content.txt'})
    lessons+=lec;exercises+=files
    print('\n',slug,'lessons',len(lec),'exercise files',len(files))
    print('Unmatched exercises:',[(x['title'],x['section']) for x in files if not x['lessonId']])
    print('No linked exercises:',[(l['index'],l['title']) for l in lec if not l['exerciseIds']])

# Browser receives manifest as JS so file:// opening also works (no fetch/CORS needed).
data={'version':1,'courses':courses,'lessons':lessons,'exercises':exercises}
(OUT/'assets').mkdir(exist_ok=True)
(OUT/'assets'/'data.js').write_text('/* Generated from the original course_content.txt and HTML filenames. */\nwindow.STUDY_DATA = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')

# Create manifest summary for QA.
(OUT/'assets'/'manifest.json').write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8')


print('Generated manifest:',len(courses),'courses,',len(lessons),'lessons,',len(exercises),'HTML exercises')
