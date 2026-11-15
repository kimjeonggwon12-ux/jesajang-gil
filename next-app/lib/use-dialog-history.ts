'use client';
import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {DialogHistory,type DialogAddress} from './dialog-history';
import {RootHistory,isHistoryInteraction,EXIT_NOTICE_MS} from './root-history';
import {loadSession} from './session';

let browserHistory: {dialogs:DialogHistory;root:RootHistory} | undefined;
function historyForBrowser() {
  if (!browserHistory) {
    const id=window.crypto.randomUUID(),port={
      state: () => window.history.state,
      url: () => window.location.href,
      push: (state:Record<string,unknown>,url?:string) => window.history.pushState(state, '', url||window.location.href),
      replace: (state:Record<string,unknown>,url?:string) => window.history.replaceState(state, '', url||window.location.href),
      go: (delta:number) => window.history.go(delta),
    };
    const dialogs=new DialogHistory(port,id),root=new RootHistory({...port,currentSession:()=>loadSession()?.token||null},id);
    browserHistory={dialogs,root};
    window.addEventListener('popstate', () => root.pop(dialogs.pop()));
    window.addEventListener('ts-session-change', () => root.sessionChanged());
    window.addEventListener('storage', () => root.sessionChanged());
    const touch=(event:Event)=>{if(isHistoryInteraction(event))root.touch();};
    for(const name of ['pointerup','keydown','click'])document.addEventListener(name,touch,true);
  }
  return browserHistory;
}

export function useRootHistory(token:string){
  const [message,setMessage]=useState('');
  useLayoutEffect(()=>{if(window.self!==window.top)return;const {root}=historyForBrowser();const unsubscribe=root.subscribe(setMessage);root.enter(token);return unsubscribe;},[token]);
  useEffect(()=>{if(!message)return;const timer=setTimeout(()=>historyForBrowser().root.clearNotice(),EXIT_NOTICE_MS);return()=>clearTimeout(timer);},[message]);
  return message;
}

export function useDialogHistory(onClose: () => void, busy = false, enabled = true, address?:DialogAddress) {
  const key = useId(), latest = useRef({onClose, busy, address});
  useLayoutEffect(() => {latest.current = {onClose, busy, address};});
  useEffect(() => {
    if (!enabled) return;
    return historyForBrowser().dialogs.register({key, close: () => latest.current.onClose(), busy: () => latest.current.busy,
      address:()=>{const value=latest.current.address;if(!value)return;return {base:new URL(value.base,window.location.href).href,open:new URL(value.open,window.location.href).href};}});
  }, [key, enabled]);
}
