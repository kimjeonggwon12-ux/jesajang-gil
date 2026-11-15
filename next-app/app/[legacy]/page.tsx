import {notFound} from 'next/navigation';
import LegacyEntry from '../../components/entry/LegacyEntry';
import {LEGACY_ENTRIES} from '../../lib/legacy-entry.mjs';
export const dynamicParams=false;
export function generateStaticParams(){return Object.keys(LEGACY_ENTRIES).map(legacy=>({legacy}));}
export default async function Page({params}:{params:Promise<{legacy:string}>}){const {legacy}=await params;if(!Object.hasOwn(LEGACY_ENTRIES,legacy))notFound();return <LegacyEntry/>;}
