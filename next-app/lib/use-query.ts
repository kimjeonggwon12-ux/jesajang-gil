'use client';
import {useCallback,useEffect,useState} from 'react';
import {useMember} from '../components/MemberArea';
import type {ReadAction} from './api';

// 응답은 해당 화면 수명 안에서만 보관한다. 조건이 바뀌면 이전 조건의 자료는 바로 숨긴다.
export function useQuery<T>(action:ReadAction,body:Record<string,unknown>={},enabled=true) {
  const {query}=useMember();
  const params=JSON.stringify(body),[version,setVersion]=useState(0);
  const key=JSON.stringify([action,params,version]);
  const [result,setResult]=useState<{key:string;data:T|null;error:string}>({key:'',data:null,error:''});
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    query<T>(action,JSON.parse(params)).then(data=>{if(active)setResult({key,data,error:''});})
      .catch(error=>{if(active)setResult({key,data:null,error:error instanceof Error?error.message:'불러오지 못했어요.'});});
    return()=>{active=false;};
  },[action,params,key,enabled,query]);
  const reload=useCallback(()=>setVersion(v=>v+1),[]);
  return {data:enabled&&result.key===key?result.data:null,error:enabled&&result.key===key?result.error:'',loading:enabled&&result.key!==key,reload};
}
