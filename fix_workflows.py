import os
import glob
import re

workflows_dir = ".github/workflows"
for filepath in glob.glob(os.path.join(workflows_dir, "*.yml")):
    with open(filepath, "r") as f:
        content = f.read()

    # Reorder corepack before setup-node and change caching
    # This regex looks for setup-node block followed by corepack block
    pattern = r"      - uses: actions/setup-node@v5\n        with:\n          node-version: '22\.16\.0'\n          package-manager-cache: false\n      - (?:name: Enable pnpm\n        shell: bash\n        )?run: \|\n          corepack enable\n          corepack prepare pnpm@10\.15\.0 --activate.*?\n"
    
    replacement = """      - name: Enable pnpm
        shell: bash
        run: |
          corepack enable
          corepack prepare pnpm@10.15.0 --activate
      - uses: actions/setup-node@v5
        with:
          node-version: '22.16.0'
          cache: 'pnpm'
"""
    
    new_content = re.sub(pattern, replacement, content, flags=re.DOTALL)
    
    # Also add Next.js caching to brand-web and platform-web
    if "brand-web.yml" in filepath:
        next_cache = """      - name: Cache Next.js
        uses: actions/cache@v4
        with:
          path: |
            apps/brand-web/.next/cache
          key: ${{ runner.os }}-nextjs-brand-${{ hashFiles('**/pnpm-lock.yaml') }}-${{ hashFiles('apps/brand-web/**/*.ts', 'apps/brand-web/**/*.tsx') }}
          restore-keys: |
            ${{ runner.os }}-nextjs-brand-${{ hashFiles('**/pnpm-lock.yaml') }}-
"""
        new_content = new_content.replace("      - run: pnpm install --frozen-lockfile\n", "      - run: pnpm install --frozen-lockfile\n" + next_cache)

    if "platform-web.yml" in filepath:
        next_cache = """      - name: Cache Next.js
        uses: actions/cache@v4
        with:
          path: |
            apps/platform-web/.next/cache
          key: ${{ runner.os }}-nextjs-platform-${{ hashFiles('**/pnpm-lock.yaml') }}-${{ hashFiles('apps/platform-web/**/*.ts', 'apps/platform-web/**/*.tsx') }}
          restore-keys: |
            ${{ runner.os }}-nextjs-platform-${{ hashFiles('**/pnpm-lock.yaml') }}-
"""
        new_content = new_content.replace("      - run: pnpm install --frozen-lockfile\n", "      - run: pnpm install --frozen-lockfile\n" + next_cache)
        
    if content != new_content:
        with open(filepath, "w") as f:
            f.write(new_content)
        print(f"Updated {filepath}")
