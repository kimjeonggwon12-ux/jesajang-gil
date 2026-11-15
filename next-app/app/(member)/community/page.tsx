import {Suspense} from 'react';
import Community from '../../../components/community/Community';
export default function CommunityPage(){return <Suspense fallback={<p>게시판을 여는 중이에요.</p>}><Community/></Suspense>;}
