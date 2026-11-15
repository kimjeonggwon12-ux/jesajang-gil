import {Suspense} from 'react';
import Activities from '../../../components/activities/Activities';
export default function ActivitiesPage(){return <Suspense fallback={<p role="status">활동을 여는 중이에요.</p>}><Activities/></Suspense>;}
