'use client';
import {useRef,useState} from 'react';
import {useMember} from '../MemberArea';
import {ErrorNote,Modal} from '../Ui';
import PostEditor from './PostEditor';
import PostDetail from './PostDetail';
export default function CaseDraft({targetId,onClose}:{targetId:string;onClose:()=>void}){const {request}=useMember(),[draft,setDraft]=useState<{title:string;body:string;basis:string}|null>(null),[postId,setPostId]=useState(''),[busy,setBusy]=useState(false),pending=useRef(false),[error,setError]=useState('');if(postId)return <PostDetail postId={postId} onClose={onClose} onChanged={()=>{}}/>;if(draft)return <PostEditor draft={draft} onClose={onClose} onSaved={setPostId}/>;return <Modal title="활동 기록으로 사례 초안" onClose={onClose} busy={busy}><p>이 대상자의 누적 기록을 바탕으로 사례 초안을 만듭니다. 내용을 직접 확인하고 수정한 뒤 게시할 수 있어요.</p><p className="muted">하루에 다섯 번까지 작성할 수 있어요. 초안을 만드는 것만으로 게시판에 올라가지는 않아요.</p><ErrorNote message={error}/><button className="primary" disabled={busy} onClick={async()=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');try{setDraft(await request('writeCaseDraft',{targetId}));}catch(e){setError((e as Error).message);}finally{pending.current=false;setBusy(false);}}}>{busy?'초안을 만드는 중…':'초안 만들기'}</button></Modal>;}
