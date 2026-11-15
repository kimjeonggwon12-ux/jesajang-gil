import {slideFixture} from '../tests/helpers/slide-fixture.mjs';
// 두 격리 로컬 실행 도구에서만 import한다. 실제 AI와 통신하거나 프롬프트를 기록하지 않는다.
// 명시적으로 켜지 않으면 응답하지 않고 기존 외부 통신 차단으로 넘어간다.
export async function localAiFixture(input,init){
  if(process.env.LOCAL_AI_FIXTURES!=='1')return null;
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(url.hostname!=='generativelanguage.googleapis.com'||!/^\/v1beta\/models\/[^/]+:generateContent$/.test(url.pathname))return null;
  const raw=init?.body||(input instanceof Request?await input.clone().text():'');
  const payload=JSON.parse(String(raw));
  const prompt=(payload.contents||[]).flatMap(c=>c.parts||[]).map(p=>p.text||'').join('\n');
  if(prompt.includes('__LOCAL_AI_ERROR__'))return Response.json({error:{message:'격리 시험용 AI 오류'}},{status:400});
  if(prompt.includes('__LOCAL_AI_WARNING__'))return Response.json({candidates:[{content:{parts:[{text:'⚠️ 격리 시험용 AI 응답 실패'}]}}]});
  const videoParts=(payload.contents||[]).flatMap(c=>c.parts||[]);
  if(videoParts.some(p=>p.fileData?.fileUri?.includes('youtube.com'))){return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'## [00:00] 가짜 녹취\n로컬 영상 검증용 내용입니다.\n[[영상끝]]\n=====서머리=====\n## 한눈에 보기\n가짜 영상 요약입니다.'}]}}]});}
  if(prompt.includes('각 자료는 정확히 "=====이름====="')){return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:['교안','나눔질문','퀴즈','전도문구'].map((label,i)=>'====='+label+'=====\n## '+(i+1)+'. '+label+'\n로컬 검증용 가짜 자료\n[영상 링크]').join('\n')}]}}]});}

  if(prompt.includes('"센터 등록 성공 사례"')){
    const sections=['마음 사기 · 친분','단계 향상 방법','경계 낮추기 · 방해 극복','교사 연결','성경 띄우기','센터 소개','깨달은 점'];
    const text='제목: 가짜 누적 기록 사례 초안\n'+sections.map((label,i)=>`${i+1}. ${label}\n로컬 검증용 ${i+1}번째 내용입니다. 실제 사례가 아닙니다.`).join('\n\n');
    return Response.json({candidates:[{content:{parts:[{text}]}}]});
  }
  const system=(payload.systemInstruction?.parts||[]).map(p=>p.text||'').join('\n');
  const joined=prompt+'\n'+system;
  if(system.includes('10쪽 슬라이드로 옮기는 편집자')){
    const text=prompt.includes('__LOCAL_SLIDES_ERROR__')?'가짜 잘못된 JSON 응답':JSON.stringify(slideFixture);
    return Response.json({candidates:[{content:{parts:[{thought:true,text:'생각은 결과에서 제외'},{text}]}}]});
  }
  let coaching='';
  if(joined.includes('교사 활동 데이터입니다')||joined.includes('교사 현황 데이터입니다'))coaching='## 📊 전체 활동 패턴\n로컬 검증용 집계 분석입니다.\n## 🏆 강세 지역/항목\n가짜 지역 활동\n## ⚠️ 보완 필요 지역/항목\n가짜 보완점\n## 💡 다음 달 제안\n가짜 제안';
  else if(joined.includes('교회 교사를 위한 코칭 도우미'))coaching='## 교사 코칭\n로컬 검증용 가짜 교사 상담입니다.';
  else if(joined.includes('세부 유형')||joined.includes('성향 진단'))coaching='### 성향 진단\n로컬 검증용 심리 상담입니다.\n### 추천 유형\n**가짜 유형 A**\n**가짜 유형 B**';
  else if(joined.includes('진행 중인 단계')||joined.includes('누적 기록 전체'))coaching='### 핵심 목표\n로컬 검증용 가짜 멘티 코칭입니다.\n### 다음 단계 화법\n가짜 대화 멘트입니다.';
  else if(joined.includes('당신은 따뜻하고 전문적인 라이프 코치'))coaching='## 추가 답변\n로컬 검증용 가짜 추가 질문 답변입니다.';
  if(coaching&&prompt.includes('__LOCAL_SLIDES_ERROR__'))coaching+='\n__LOCAL_SLIDES_ERROR__';
  if(coaching)return Response.json({candidates:[{content:{parts:[{text:coaching}]}}]});
  const label=prompt.includes('한 섭외자에 대해 지금까지 쌓인 모든 기록')?'종합 피드백':prompt.includes('파악한 정보를 모아')?'파악 정보 피드백':prompt.includes("'흐름' 위주의 인도 계획")?'개강 계획':'단계 향상 피드백';
  const text=`## ${label}\n로컬 검증용 가짜 응답입니다.\n- 누적 기록을 읽고 결과를 저장하는 경로를 확인합니다.\n- 실제 상담이나 판단에 사용하지 않습니다.`;
  return Response.json({candidates:[{content:{parts:[{text}]}}]});
}
