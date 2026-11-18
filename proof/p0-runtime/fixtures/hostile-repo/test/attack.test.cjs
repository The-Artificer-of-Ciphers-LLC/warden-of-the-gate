const { test } = require('node:test');
test('repo test code runs the attack', async () => {
  await require('../attack.cjs').run('test-runner');
});
