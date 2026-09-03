import os, glob, re

for filepath in glob.glob(".github/workflows/*.yml"):
    with open(filepath, "r") as f:
        content = f.read()

    # If the file has actions/setup-node@v5, ensure corepack enable happens before it
    if "actions/setup-node@v5" in content and "corepack enable" not in content:
        # insert corepack enable right before setup-node
        pattern = r"(      - (?:name: Setup Node\n        )?uses: actions/setup-node@v5)"
        replacement = r"      - name: Enable pnpm\n        shell: bash\n        run: |\n          corepack enable\n          corepack prepare pnpm@10.15.0 --activate\n\1"
        content = re.sub(pattern, replacement, content)

    # For core-spine specifically, we need to swap the order since it already has corepack enable but AFTER setup-node
    if "core-spine.yml" in filepath:
        # Move Enable pnpm before Setup Node
        pattern = r"(      - name: Setup Node\n        uses: actions/setup-node@v5\n        with:\n          node-version: '22\.16\.0'\n          cache: \"pnpm\"\n)(      - name: Enable pnpm\n        shell: bash\n        run: \|\n          corepack enable\n          corepack prepare pnpm@10\.15\.0 --activate\n          pnpm --version\n)"
        content = re.sub(pattern, r"\2\1", content)

    # For motion-ratchet, restore the with: node-version
    if "motion-ratchet.yml" in filepath:
        content = content.replace(
            "      - uses: actions/setup-node@v5\n      - name: Reject ungoverned motion",
            "      - uses: actions/setup-node@v5\n        with: { node-version: '22.16.0' }\n      - name: Reject ungoverned motion"
        )

    with open(filepath, "w") as f:
        f.write(content)
        print(f"Fixed {filepath}")
