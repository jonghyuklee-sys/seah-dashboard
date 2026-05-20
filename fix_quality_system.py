import os
import shutil
import time

def fix():
    base_path = r"g:\내 드라이브\이종혁\AI\세아씨엠 품질 조회 시스템"
    temp_path = r"g:\내 드라이브\이종혁\AI\세아씨엠 품질 조회 시스템_REFRESH"

    print(f"Checking {base_path}...")
    
    # 1. Delete .git
    git_path = os.path.join(base_path, ".git")
    if os.path.exists(git_path):
        print(f"Deleting {git_path}...")
        try:
            shutil.rmtree(git_path, ignore_errors=True)
            print("Successfully deleted .git")
        except Exception as e:
            print(f"Error deleting .git: {e}")

    # 2. Delete .claude
    claude_path = os.path.join(base_path, ".claude")
    if os.path.exists(claude_path):
        print(f"Deleting {claude_path}...")
        try:
            shutil.rmtree(claude_path, ignore_errors=True)
            print("Successfully deleted .claude")
        except Exception as e:
            print(f"Error deleting .claude: {e}")

    # 3. Force refresh by renaming
    print("Renaming folder to force refresh...")
    try:
        if os.path.exists(base_path):
            os.rename(base_path, temp_path)
            time.sleep(2)
            os.rename(temp_path, base_path)
            print("Folder refresh complete!")
    except Exception as e:
        print(f"Error during refresh: {e}")

if __name__ == "__main__":
    fix()
