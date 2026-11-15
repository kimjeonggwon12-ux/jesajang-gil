'use client';
import {useState} from 'react';
import contacts from './classic-contacts.json';
import {Modal} from '../Ui';
export default function ClassicContact({part}:{part:keyof typeof contacts}){
 const contact=contacts[part],[open,setOpen]=useState(false),phone=contact.phone.replace(/[^0-9+]/g,'');
 return <div className="classic-contact-space"><button className="ctc" onClick={()=>setOpen(true)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg> 문의 <b>{contact.name}</b> {contact.phone}</button>{open?<Modal title="담당자 문의" onClose={()=>setOpen(false)}><p>{contact.name} {contact.phone}</p>{phone?<div className="toolbar"><a className="secondary" href={'tel:'+phone}>전화</a><a className="secondary" href={'sms:'+phone}>문자</a><a className="secondary" href={'https://t.me/'+(phone.startsWith('0')?'+82'+phone.slice(1):phone)} target="_blank" rel="noreferrer">텔레그램</a></div>:null}</Modal>:null}</div>;
}
