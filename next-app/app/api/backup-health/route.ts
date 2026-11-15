import 'server-only';
import handler from '../../../../api/backup-health.js';
import {webHandler} from '../../../../server/lib/web-handler.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const handle = webHandler(handler);
export {handle as GET, handle as POST, handle as OPTIONS, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD};
