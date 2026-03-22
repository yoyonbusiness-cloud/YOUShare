const git = require('isomorphic-git');
const fs = require('fs');
const path = require('path');
const http = require('isomorphic-git/http/node');

const dir = process.cwd();
const remoteUrl = 'https://github.com/yoyonbusiness-cloud/YOUShare.git';

async function deploy() {
    console.log('--- Initializing Git Repo ---');
    try {
        await git.init({ fs, dir });
        console.log('Git repo initialized.');
    } catch (e) {
        console.log('Repo already initialized or error:', e.message);
    }

    console.log('--- Staging Files ---');

    const files = await git.listFiles({ fs, dir });

    async function walk(currentDir) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const relPath = path.relative(dir, fullPath).replace(/\\/g, '/');

            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                await walk(fullPath);
            } else {

                if (relPath === '.gitignore' || relPath === 'package-lock.json') {

                }
                await git.add({ fs, dir, filepath: relPath });
            }
        }
    }

    await walk(dir);
    console.log('Files staged.');

    console.log('--- Committing ---');
    let sha = await git.commit({
        fs,
        dir,
        author: {
            name: 'Antigravity AI',
            email: 'antigravity@gemini.ai'
        },
        message: 'Initial production build: Hyper-Speed P2P Masterpiece'
    });
    console.log('Commit created:', sha);

    console.log('--- Adding Remote ---');
    try {
        await git.addRemote({ fs, dir, remote: 'origin', url: remoteUrl });
    } catch (e) {
        console.log('Remote already exists.');
    }

    const token = process.argv[2];
    if (!token) {
        console.log('\n[WAIT] No GitHub token provided.');
        console.log('Please run: node git-deploy.js YOUR_GITHUB_TOKEN');
        process.exit(0);
    }

    console.log('--- Pushing to GitHub ---');
    try {
        let pushResult = await git.push({
            fs,
            http,
            dir,
            remote: 'origin',
            onAuth: () => ({ username: token }) 
        });
        console.log('Push completed successfully.');
    } catch (err) {
        console.error('Push failed:', err.message);
        console.log('\nTroubleshooting:');
        console.log('1. Ensure the token has "repo" permissions.');
        console.log('2. Ensure the repository exists and you have write access.');
    }
}

deploy();
