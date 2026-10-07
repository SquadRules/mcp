import { runSpacesToolContract } from '../contracts/spaces-tool.contract.js';
import { createStdioSimpleHarness } from '../harness/stdio-simple.js';
import { isHttpTransport } from '../../utils/auth-headers.js';

// SINGLE mode is stdio: run the stdio contract whenever the transport is not HTTP. Under
// CLUSTER (http) this self-skips, mirroring spaces-tool.http-simple / http-auth.
if (!isHttpTransport()) {
  runSpacesToolContract('spaces tool / stdio-simple', createStdioSimpleHarness);
} else {
  describe.skip('spaces tool / stdio-simple', () => {
    test('skipped: requires stdio transport', () => {});
  });
}
