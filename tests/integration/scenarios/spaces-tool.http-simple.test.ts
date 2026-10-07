import { runSpacesToolContract } from '../contracts/spaces-tool.contract.js';
import { createHttpSimpleHarness } from '../harness/http-simple.js';
import { isHttpTransport, serverRequiresAuth } from '../../utils/auth-headers.js';

if (isHttpTransport() && !serverRequiresAuth()) {
  runSpacesToolContract('spaces tool / http-simple', createHttpSimpleHarness);
} else {
  describe.skip('spaces tool / http-simple', () => {
    test('skipped: requires HTTP transport without auth', () => {});
  });
}
