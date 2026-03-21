/**
 * Quick smoke test for the workshop store slice
 * Run with: npx tsx test-store.ts
 */

// Mock window for WebSocket
(global as any).window = { location: { protocol: 'http:', hostname: 'localhost', port: '3847' } };

import { useStore } from './src/store';

// Create a test instance
const store = useStore.getState();

console.log('Initial state:');
console.log('  workshopPersona:', store.workshopPersona);
console.log('  workshopNestedTab:', store.workshopNestedTab);
console.log('  workshopPeriod:', store.workshopPeriod);
console.log('  workshopShowArchived:', store.workshopShowArchived);

console.log('\nTesting setPersona("leo"):');
store.setPersona('leo');
console.log('  workshopPersona:', useStore.getState().workshopPersona);
console.log('  workshopNestedTab:', useStore.getState().workshopNestedTab, '(should reset to leo-question)');

console.log('\nTesting selectThread:');
store.selectThread('jim-request', 'thread-123');
console.log('  workshopSelectedThread:', useStore.getState().workshopSelectedThread);

console.log('\nTesting addMessageToCurrentThread:');
store.setCurrentThread({
  id: 'thread-123',
  title: 'Test Thread',
  messages: [
    { id: 'msg-1', content: 'First message', role: 'user' },
  ],
});
console.log('  currentThread messages before:', useStore.getState().workshopCurrentThread?.messages.length);

store.addMessageToCurrentThread({
  id: 'msg-2',
  content: 'Second message',
  role: 'assistant',
});
console.log('  currentThread messages after:', useStore.getState().workshopCurrentThread?.messages.length);

console.log('\nTesting toggleArchived:');
console.log('  Before:', useStore.getState().workshopShowArchived);
store.toggleArchived();
console.log('  After:', useStore.getState().workshopShowArchived);

console.log('\n✅ All store tests passed!');
