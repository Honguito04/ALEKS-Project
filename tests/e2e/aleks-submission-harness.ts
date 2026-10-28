import { AleksSubmission } from '../../extension/src/aleks-submission';
import { assistContext } from '../../extension/src/aleks-assist';
declare global {interface Window {AleksSubmission:typeof AleksSubmission;assistContext:typeof assistContext}}
window.AleksSubmission=AleksSubmission;
window.assistContext=assistContext;
