// Global test setup — provides the $tw mock before any module is loaded.
const { createMockTw } = require('./mock-tw');
global.$tw = createMockTw();
