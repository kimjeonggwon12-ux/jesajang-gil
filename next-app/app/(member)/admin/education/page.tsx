import {Suspense} from 'react';
import Education from '../../../../components/education/Education';
export default function Page(){return <Suspense fallback={<p role="status">교육 과정을 여는 중이에요.</p>}><Education/></Suspense>;}
