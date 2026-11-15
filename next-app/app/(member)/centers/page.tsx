import {Suspense} from 'react';
import CenterDesk from '../../../components/centers/CenterDesk';
export default function CentersPage(){return <Suspense fallback={<p role="status">센터 업무를 여는 중이에요.</p>}><CenterDesk/></Suspense>;}
