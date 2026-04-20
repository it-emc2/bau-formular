import os
import shutil

# 👉 CHANGE THIS if needed (root of your project)
PROJECT_ROOT = os.path.abspath(".")

# 👉 Output folder
EXPORT_DIR = os.path.join(PROJECT_ROOT, "export_for_chatgpt")

# ✅ Files to copy (relative to project root)
FILES_TO_COPY = [
    "server.js",
    "package.json",
    "package-lock.json",
    "Dockerfile",
    "fly.toml",
    ".env",

    # Routes
    "routes/form.js",
    "routes/bitrix.js",

    # Services
    "services/stepDocuments.js",
    "services/documentLetter.js",
    "services/bitrix.js",

    # Models
    "models/Abnahme.js",
    "models/Entwurf.js",

    # Frontend
    "public/app.js",
    "public/documentLetter.js",
    "public/index.html",

    # Tests (optional)
    "__tests__/routes.form.test.js",
    "__tests__/stepDocuments.test.js",
]

# 👉 Template folder (copy ONE file automatically)
TEMPLATE_DIR = "templates/checklists"

def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path)

def copy_file(rel_path):
    src = os.path.join(PROJECT_ROOT, rel_path)
    dst = os.path.join(EXPORT_DIR, rel_path)

    if not os.path.exists(src):
        print(f"⚠️ Skipped (not found): {rel_path}")
        return

    ensure_dir(os.path.dirname(dst))
    shutil.copy2(src, dst)
    print(f"✅ Copied: {rel_path}")

def copy_one_template():
    template_path = os.path.join(PROJECT_ROOT, TEMPLATE_DIR)

    if not os.path.exists(template_path):
        print("⚠️ No template folder found")
        return

    files = [f for f in os.listdir(template_path) if f.endswith(".docx")]

    if not files:
        print("⚠️ No .docx template found")
        return

    # take first file
    chosen = files[0]
    rel_path = os.path.join(TEMPLATE_DIR, chosen)

    copy_file(rel_path)
    print(f"📄 Template selected: {chosen}")

def main():
    print("\n🚀 Exporting files for ChatGPT...\n")

    ensure_dir(EXPORT_DIR)

    for f in FILES_TO_COPY:
        copy_file(f)

    copy_one_template()

    print("\n🎉 Done! Files are in:", EXPORT_DIR)

if __name__ == "__main__":
    main()