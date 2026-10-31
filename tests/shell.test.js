const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyShell } = require('../src/main/policy/shell.js');

function cases(expected, commands, isTest = false) {
  for (const cmd of commands) {
    test(`${expected}: ${cmd}`, () => {
      assert.deepEqual(classifyShell(cmd), { class: expected, isTest });
    });
  }
}

cases('safe-test', ['npm test', 'npm t', 'npm run test', 'npm run test:auth', 'npm test -- --grep auth', 'node --test', 'node --test tests/a.test.js',
  'pnpm test', 'yarn test', 'pytest', 'python -m pytest -q', 'go test ./...', 'cargo test', 'NPM.CMD test'], true);

cases('git-read', ['git status', 'git diff', 'git diff main...HEAD', 'git log --oneline -5', 'git show HEAD', 'git branch', 'git branch -a', 'git rev-parse HEAD', 'git blame src/a.js']);

cases('git-write', ['git add .', 'git commit -m "fix: auth"', 'git checkout -b x', 'git branch feature/y', 'git stash', 'git merge main', 'git reset HEAD src/a.js', 'git restore src/a.js']);

cases('git-push', ['git push', 'git push origin zonder/raka-a1b2c3']);

cases('git-force', ['git push --force', 'git push -f', 'git push --force-with-lease', 'git push origin +main', 'git push -uf origin x']);

cases('history-rewrite', ['git reset --hard origin/x', 'git reset --soft HEAD~1', 'git rebase main', 'git rebase -i HEAD~3', 'git filter-branch --tree-filter x', 'git commit --amend', 'git reflog expire --all']);

cases('install', ['npm i x', 'npm install', 'npm install zod', 'npm ci', 'npm add x', 'pnpm add x', 'yarn add x', 'yarn', 'npx create-thing', 'pip install requests', 'python -m pip install x', 'winget install x']);

cases('delete', ['rm -rf x', 'rm x', 'del x', 'erase x', 'rmdir /s x', 'rd x', 'Remove-Item x', 'git rm src/a.js', 'git clean -fd']);

cases('unknown', ['cd .. && git push -f', 'echo a > b', 'node -e "console.log(1)"', '$(x)', 'echo `whoami`', 'npm test; rm -rf /', 'npm test | tee log',
  'npm test & calc', 'npm test\nrm x', 'cd src', 'echo %PATH%', 'git -C ../other status', 'git -c core.pager=evil log', 'git config alias.x "!rm"',
  'git worktree add ../x', 'node script.js', 'npm run build', 'ls', 'curl http://x', 'git commit -m "unterminated', '', '   ']);
