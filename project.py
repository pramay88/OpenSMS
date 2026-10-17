from pathlib import Path
import fnmatch
import sys


# Extra patterns to ignore in addition to .gitignore
EXTRA_IGNORE = {
    "node_modules",
    ".git",
    "__pycache__",
    ".next",
    ".venv",
    "venv",
    "dist",
    "build",
    ".cache",
    "coverage",
    ".next",
}


def load_gitignore(project_root: Path):
    """Load non-comment, non-empty patterns from .gitignore."""
    gitignore = project_root / ".gitignore"

    if not gitignore.exists():
        return []

    patterns = []

    with gitignore.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()

            # Ignore blank lines and comments
            if not line or line.startswith("#"):
                continue

            patterns.append(line)

    return patterns


def is_ignored(path: Path, project_root: Path, gitignore_patterns):
    """Check whether a file/directory should be ignored."""

    name = path.name

    # Simple name-based ignores
    if name in EXTRA_IGNORE:
        return True

    relative = path.relative_to(project_root).as_posix()

    # Check .gitignore patterns
    for pattern in gitignore_patterns:

        # Remove leading slash
        clean_pattern = pattern.lstrip("/")

        # Directory pattern
        if clean_pattern.endswith("/"):
            clean_pattern = clean_pattern.rstrip("/")

        # Match entire relative path
        if fnmatch.fnmatch(relative, clean_pattern):
            return True

        # Match filename/directory name
        if fnmatch.fnmatch(name, clean_pattern):
            return True

        # Match paths ending with the pattern
        if fnmatch.fnmatch(relative, f"*/{clean_pattern}"):
            return True

    return False


def print_tree(
    directory: Path,
    project_root: Path,
    gitignore_patterns,
    prefix=""
):
    """Recursively print project architecture."""

    try:
        entries = sorted(
            directory.iterdir(),
            key=lambda p: (p.is_file(), p.name.lower())
        )
    except PermissionError:
        return

    # Remove ignored entries
    entries = [
        entry
        for entry in entries
        if not is_ignored(entry, project_root, gitignore_patterns)
    ]

    for index, entry in enumerate(entries):

        is_last = index == len(entries) - 1

        connector = "└── " if is_last else "├── "

        print(prefix + connector + entry.name)

        if entry.is_dir():
            new_prefix = prefix + ("    " if is_last else "│   ")

            print_tree(
                entry,
                project_root,
                gitignore_patterns,
                new_prefix
            )


def main():
    # Allow:
    # python project_tree.py <project-folder>
    if len(sys.argv) > 1:
        project_root = Path(sys.argv[1]).resolve()
    else:
        project_root = Path.cwd()

    if not project_root.exists():
        print(f"Error: {project_root} does not exist.")
        return

    if not project_root.is_dir():
        print(f"Error: {project_root} is not a directory.")
        return

    gitignore_patterns = load_gitignore(project_root)

    print(project_root.name)
    print_tree(
        project_root,
        project_root,
        gitignore_patterns
    )


if __name__ == "__main__":
    main()