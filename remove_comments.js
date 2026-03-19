const fs = require('fs');
const path = require('path');

function removeComments(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath);
    
    if (ext === '.js' || ext === '.css') {
        // Remove multi-line comments
        content = content.replace(/\/\*[\s\S]*?\*\//g, '');
        // Remove single-line comments, but preserve URLs like http://
        content = content.replace(/(?<!https?:|ftp:)\/\/.*/g, '');
    } else if (ext === '.html') {
        // Remove HTML comments
        content = content.replace(/<!--[\s\S]*?-->/g, '');
        // Also strip JS/CSS comments inside HTML cautiously
        content = content.replace(/\/\*[\s\S]*?\*\//g, '');
        content = content.replace(/(?<!https?:|ftp:)\/\/.*/g, '');
    }
    
    // Optionally clean up excessive blank lines
    content = content.replace(/^\s*[\r\n]/gm, '\n');
    
    fs.writeFileSync(filePath, content, 'utf8');
}

function processDirectory(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file === 'node_modules' || file === '.git' || file === 'dist' || file.endsWith('.json') || file.endsWith('.md') || file === 'remove_comments.js') {
            continue;
        }
        
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDirectory(fullPath);
        } else if (['.js', '.css', '.html'].includes(path.extname(fullPath))) {
            removeComments(fullPath);
            console.log(`Cleaned: ${fullPath}`);
        }
    }
}

processDirectory(__dirname);
console.log('All comments successfully stripped.');
