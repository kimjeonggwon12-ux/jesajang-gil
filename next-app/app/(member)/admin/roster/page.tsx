import {Suspense} from 'react';
import RosterAdmin from '../../../../components/roster/RosterAdmin';
export default function RosterAdminPage(){return <Suspense fallback={<p role="status">명단 관리를 여는 중이에요.</p>}><RosterAdmin/></Suspense>;}
