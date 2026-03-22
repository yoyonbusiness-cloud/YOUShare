const fs = require('fs');
let code = fs.readFileSync('webrtc.js', 'utf8');

// Strip emojis from auditLog calls
const emojis = ['🔑', '🤝', '🔐', '🔒', '⚡', '🚀', '⚠️', '📩', '🔗', '✅', '❌'];
const emojiPattern = new RegExp(`auditLog\\((['"\`])(?:${emojis.join('|')})\\s*(.*?)\\1\\)`, 'g');
code = code.replace(emojiPattern, "auditLog($1$2$1)");

// Also fix the console.log AUDIT
code = code.replace(/%c⚡ AUDIT/g, '%cAUDIT');

fs.writeFileSync('webrtc.js', code);
console.log('Emojis stripped from webrtc.js');
