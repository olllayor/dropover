const { app, protocol } = require('electron');
console.log('app:', typeof app);
console.log('protocol:', typeof protocol);
console.log('keys:', protocol ? Object.keys(protocol).slice(0, 10) : 'n/a');