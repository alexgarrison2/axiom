#!/usr/bin/env python3
import argparse
import os
import sys

def init_skill(name, path):
    """Initialize a new skill directory with default structure and files."""
    
    # Clean name
    name = name.strip()
    
    # Target directory for the skill
    skill_dir = os.path.join(path, name)
    
    # Check if already exists
    if os.path.exists(skill_dir):
        print(f"Error: Directory '{skill_dir}' already exists.")
        sys.exit(1)
        
    try:
        # Create directories
        os.makedirs(skill_dir)
        os.makedirs(os.path.join(skill_dir, 'scripts'))
        os.makedirs(os.path.join(skill_dir, 'references'))
        os.makedirs(os.path.join(skill_dir, 'assets'))
        
        # Create SKILL.md template
        skill_md_content = f"""---
name: {name}
description: TODO - Add a clear, comprehensive description of what this skill does and when to use it.
---

# {name.replace('-', ' ').title()}

## Overview

TODO: Add a high-level overview of the skill.

## Workflows

### Primary Workflow

1. Step 1
2. Step 2

## References

- [Example Reference](references/example.md)
"""
        
        with open(os.path.join(skill_dir, 'SKILL.md'), 'w') as f:
            f.write(skill_md_content)
            
        # Create example files
        with open(os.path.join(skill_dir, 'scripts', 'example.py'), 'w') as f:
            f.write("# Example script\nprint('Hello from the skill script')\n")
            
        with open(os.path.join(skill_dir, 'references', 'example.md'), 'w') as f:
            f.write("# Example Reference\n\nThis is an example reference file.\n")
            
        print(f"✅ Successfully initialized skill '{name}' at '{skill_dir}'")
        print(f"Next steps:")
        print(f"1. Edit {os.path.join(skill_dir, 'SKILL.md')}")
        print(f"2. Add scripts to {os.path.join(skill_dir, 'scripts')}")
        print(f"3. Add references to {os.path.join(skill_dir, 'references')}")
        
    except Exception as e:
        print(f"Error initializing skill: {e}")
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Initialize a new skill with standard directory structure")
    parser.add_argument("name", help="Name of the skill (kebab-case recommended)")
    parser.add_argument("--path", default=".", help="Parent directory for the skill (default: current directory)")
    
    args = parser.parse_args()
    init_skill(args.name, args.path)
