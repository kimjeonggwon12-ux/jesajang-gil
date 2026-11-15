import 'server-only';
import {roomDownload} from '../../../../server/lib/room-download.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export {roomDownload as POST,roomDownload as GET,roomDownload as HEAD};
