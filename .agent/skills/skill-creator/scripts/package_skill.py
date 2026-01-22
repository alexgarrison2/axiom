#!/usr/bin/env python3
import argparse
import os
import sys
import zipfile
import re

def validate_skill(skill_path):
    """Validate skill structure and required files."""
    print(f"Validating skill at '{skill_path}'...")
    
    # Check if directory exists
    if not os.path.exists(skill_path) or not os.path.isdir(skill_path):
        print(f"❌ Error: '{skill_path}' is not a valid directory.")
        return False
        
    # Check for SKILL.md
    skill_md = os.path.join(skill_path, "SKILL.md")
    if not os.path.exists(skill_md):
        print(f"❌ Error: SKILL.md not found in '{skill_path}'.")
        return False
        
    # Validate Frontmatter
    try:
        with open(skill_md, 'r') as f:
            content = f.read()
            
        if not content.startswith("---"):
            print("❌ Error: SKILL.md must start with YAML frontmatter (---).")
            return False
            
        # extract frontmatter
        match = re.search(r'^---\n(.*?)\n---', content, re.DOTALL)
        if not match:
            print("❌ Error: Could not parse YAML frontmatter in SKILL.md.")
            return False
            
        frontmatter = match.group(1)
        if "name:" not in frontmatter:
            print("❌ Error: 'name' field missing in frontmatter.")
            return False
        if "description:" not in frontmatter:
            print("❌ Error: 'description' field missing in frontmatter.")
            return False
            
    except Exception as e:
        print(f"❌ Error reading SKILL.md: {e}")
        return False
        
    print("✅ Validation passed.")
    return True

def package_skill(skill_path, dist_path):
    """Package the skill into a .skill zip file."""
    
    skill_path = os.path.abspath(skill_path)
    skill_name = os.path.basename(skill_path)
    
    if not validate_skill(skill_path):
        print("Packaging aborted due to validation errors.")
        sys.exit(1)
        
    # Prepare output directory
    if not os.path.exists(dist_path):
        os.makedirs(dist_path)
        
    output_filename = os.path.join(dist_path, f"{skill_name}.skill")
    
    try:
        with zipfile.ZipFile(output_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # Walk through the skill directory and add files
            parent_dir = os.path.dirname(skill_path)
            
            for root, dirs, files in os.walk(skill_path):
                for file in files:
                    file_path = os.path.join(root, file)
                    # Create the archive name (relative path inside the zip)
                    # We want the zip to contain the skill folder itself, e.g. skill-name/SKILL.md
                    arcname = os.path.relpath(file_path, parent_dir)
                    zipf.write(file_path, arcname)
                    
        print(f"✅ Successfully packaged skill to: {output_filename}")
        
    except Exception as e:
        print(f"❌ Error packaging skill: {e}")
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Package a skill into a .skill distributable file")
    parser.add_argument("skill_path", help="Path to the skill directory")
    parser.add_argument("dist_path", nargs="?", default=".", help="Output directory for the .skill file (default: current directory)")
    
    args = parser.parse_args()
    package_skill(args.skill_path, args.dist_path)
