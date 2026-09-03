import os, glob, re

for filepath in glob.glob(".github/workflows/*.yml"):
    with open(filepath, "r") as f:
        content = f.read()

    # Move setup-node after corepack if it's before it
    pattern = r"(      - name: Setup Node\n        uses: actions/setup-node@v5\n        with:\n          node-version: '22\.16\.0'\n          cache: \"pnpm\"\n\n)(      - name: Enable pnpm\n        shell: bash\n        run: \|\n          corepack enable\n          corepack prepare pnpm@10\.15\.0 --activate(?:.*?\n)?)"
    
    new_content = re.sub(pattern, r"\2\1", content, flags=re.DOTALL)
    
    # Check for the ratchet scripts
    pattern2 = r"(      - name: Setup Node\n        uses: actions/setup-node@v5\n        with:\n          node-version: '22\.16\.0'\n          cache: \"pnpm\"\n)"
    # Wait, the ratchets don't even have corepack! They just use `setup-node`. If they don't use pnpm, maybe they shouldn't cache pnpm, or they don't even need pnpm if they just run `node scripts/...`.
    # Let's check ratchet files.
    
    if content != new_content:
        with open(filepath, "w") as f:
            f.write(new_content)
        print(f"Fixed {filepath}")
